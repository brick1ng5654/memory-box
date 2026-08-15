import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addEdge, applyNodeChanges, Background, BackgroundVariant, BaseEdge, Connection, ConnectionMode, Edge, EdgeProps, getBezierPath, NodeChange, OnConnect, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api, Asset, Board, MemoryEdge, MemoryNode, NodeType, mediaUrl } from './api'
import MemoryCard, { FlowMemoryNode } from './MemoryCard'
import Editor from './Editor'

const nodeTypes = { memory: MemoryCard }
const monthNames = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const formatDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${value}T00:00:00`))
const formatPeriod = (board: Pick<Board, 'start_date' | 'end_date'>) => board.start_date === board.end_date ? formatDate(board.start_date) : `${formatDate(board.start_date)} — ${formatDate(board.end_date)}`
const toDateKey = (value: Date) => `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`
const todayKey = () => toDateKey(new Date())
const defaultNodeWidth = (node: MemoryNode) => node.type === 'media' ? 300 : node.type === 'track' ? node.track_data?.cover_size === 'large' ? 320 : 340 : 230
const defaultNodeHeight = (node: MemoryNode) => node.type === 'media' ? 260 : node.type === 'track' ? node.track_data?.cover_size === 'large' ? node.track_data?.kind === 'playlist' ? 320 : 390 : node.track_data?.kind === 'playlist' ? 220 : 180 : undefined
const clipboardMediaExtensions: Record<string, string> = {
  'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov', 'video/x-m4v': 'm4v',
}
type Theme = 'dark' | 'light'

const toFlowNode = (node: MemoryNode, onOpenMedia: (assets: Asset[], index: number) => void, onObjectChange?: (patch: Partial<MemoryNode>) => void, onPlaylistToggle?: (id: number) => void, theme: Theme = 'dark'): FlowMemoryNode => ({
  id: String(node.id), type: 'memory', position: { x: node.position_x, y: node.position_y },
  style: { width: node.width ?? defaultNodeWidth(node), height: node.height ?? defaultNodeHeight(node), zIndex: node.z_index },
  data: { ...node, onOpenMedia, onObjectChange, onPlaylistToggle: onPlaylistToggle ? () => onPlaylistToggle(node.id) : undefined, theme },
})
const toFlowEdge = (edge: MemoryEdge): Edge => ({
  id: String(edge.id), type: 'memory', source: String(edge.source_node_id), sourceHandle: edge.source_handle || 'right', target: String(edge.target_node_id), targetHandle: edge.target_handle || 'left', label: edge.label || undefined,
  style: { stroke: '#a38dcc', strokeWidth: 1.6, strokeLinecap: 'round' },
})

function MemoryBezierEdge({ id, sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, style }: EdgeProps) {
  const [path] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.45 })
  return <BaseEdge id={id} path={path} style={style} />
}

const edgeTypes = { memory: MemoryBezierEdge }

function BoardCanvas({ boardId, onHome, theme, onToggleTheme }: { boardId: number; onHome: () => void; theme: Theme; onToggleTheme: () => void }) {
  const { screenToFlowPosition, setCenter } = useReactFlow()
  const [board, setBoard] = useState<Board | null>(null)
  const [nodes, setNodes] = useNodesState<FlowMemoryNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([])
  const [selected, setSelected] = useState<MemoryNode | null>(null)
  const [selectedIds, setSelectedIds] = useState<number[]>([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<number[]>([])
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(true)
  const [lightbox, setLightbox] = useState<{ assets: Asset[]; index: number } | null>(null)
  const [deleteDialog, setDeleteDialog] = useState(false)
  const [clipboard, setClipboard] = useState<MemoryNode | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; nodeId?: number; nodeIds?: number[]; edgeIds?: number[] } | null>(null)
  const [zoom, setZoom] = useState(1)
  const [initialFocus, setInitialFocus] = useState<{ x: number; y: number } | null>(null)
  const confirmButton = useRef<HTMLButtonElement>(null)
  const nodesRef = useRef(nodes)
  const selectedRef = useRef<MemoryNode | null>(null)
  const selectionRef = useRef<number[]>([])
  const edgeSelectionRef = useRef<number[]>([])
  const contextSelectionRef = useRef<{ nodeIds: number[]; edgeIds: number[] }>({ nodeIds: [], edgeIds: [] })
  const zoomRef = useRef(1)
  const connectionSourceRef = useRef<string | null>(null)
  const connectionCandidateRef = useRef<string | null>(null)
  const canvasRef = useRef<HTMLElement>(null)
  const canvasPointerRef = useRef<{ x: number; y: number } | null>(null)
  const imageInputRef = useRef<HTMLInputElement>(null)
  const pendingImagePositionRef = useRef<{ x: number; y: number } | null>(null)
  const objectChangeRef = useRef<(id: string, patch: Partial<MemoryNode>) => void>(() => {})
  const objectSyncTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({})
  const objectSyncPatchesRef = useRef<Record<string, Partial<MemoryNode>>>({})
  const themeRef = useRef(theme)
  themeRef.current = theme
  const objectChange = useCallback((id: number, patch: Partial<MemoryNode>) => objectChangeRef.current(String(id), patch), [])
  const previewTextFont = useCallback((id: number, fontFamily: string | null) => {
    setNodes(current => current.map(node => node.id === String(id) ? {
      ...node,
      data: { ...node.data, previewObjectData: fontFamily ? { ...(node.data.object_data || {}), font_family: fontFamily } : undefined },
    } : node))
  }, [setNodes])
  const togglePlaylistOpen = useCallback((id: number) => {
    setNodes(current => current.map(node => node.id === String(id) ? { ...node, data: { ...node.data, playlistOpen: !node.data.playlistOpen } } : node))
  }, [setNodes])

  const openMedia = useCallback((assets: Asset[], index: number) => setLightbox({ assets, index }), [])
  const load = useCallback(async () => {
    try {
      const next = await api.board(boardId)
      setBoard(next)
      setNodes(next.nodes.map(node => toFlowNode(node, openMedia, patch => objectChange(node.id, patch), togglePlaylistOpen, themeRef.current)))
      setEdges(next.edges.map(toFlowEdge))
      const datedNodes = next.nodes.filter(node => node.temporal_date).sort((left, right) => (left.temporal_date || '').localeCompare(right.temporal_date || '') || left.id - right.id)
      const focusNode = datedNodes[0] || next.nodes[0]
      if (focusNode) setInitialFocus({ x: focusNode.position_x + (focusNode.width ?? defaultNodeWidth(focusNode)) / 2, y: focusNode.position_y + (focusNode.height ?? defaultNodeHeight(focusNode) ?? 180) / 2 })
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось загрузить холст')
    } finally { setLoading(false) }
  }, [boardId, openMedia, setEdges, setNodes, togglePlaylistOpen])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    setNodes(current => current.map(node => ({ ...node, data: { ...node.data, theme } })))
  }, [setNodes, theme])
  useEffect(() => {
    if (loading || !initialFocus) return
    const frame = requestAnimationFrame(() => { zoomRef.current = 0.85; setZoom(0.85); void setCenter(initialFocus.x, initialFocus.y, { zoom: 0.85, duration: 0 }) })
    return () => cancelAnimationFrame(frame)
  }, [initialFocus, loading, setCenter])
  useEffect(() => { nodesRef.current = nodes }, [nodes])
  useEffect(() => { selectedRef.current = selected }, [selected])
  useEffect(() => { if (deleteDialog) requestAnimationFrame(() => confirmButton.current?.focus()) }, [deleteDialog])
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement
      if (target.closest('input, textarea, select, [contenteditable="true"]')) return
      if (lightbox) {
        if (event.key === 'ArrowLeft') setLightbox(current => current ? { ...current, index: (current.index - 1 + current.assets.length) % current.assets.length } : current)
        if (event.key === 'ArrowRight') setLightbox(current => current ? { ...current, index: (current.index + 1) % current.assets.length } : current)
        if (event.key === 'Escape') setLightbox(null)
        return
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c' && selected) { event.preventDefault(); setClipboard(selected); return }
      if (event.key === 'Delete' && selectedEdgeIds.length) {
        event.preventDefault()
        const ids = new Set(selectedEdgeIds)
        void Promise.all([...ids].map(id => api.deleteEdge(id))).then(() => {
          setEdges(current => current.filter(edge => !ids.has(Number(edge.id))))
          setBoard(current => current ? { ...current, edges: current.edges.filter(edge => !ids.has(edge.id)) } : current)
          setSelectedEdgeIds([])
        }).catch(error => setNotice(error instanceof Error ? error.message : 'Не удалось удалить связь'))
        return
      }
      if (event.key === 'Delete' && selectedIds.length) { event.preventDefault(); setDeleteDialog(true) }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [lightbox, selected, selectedIds, selectedEdgeIds, clipboard, setEdges])

  const replaceNode = useCallback((updated: MemoryNode, preserveExistingMedia = false) => {
    setNodes(list => list.map(node => node.id === String(updated.id) ? {
      ...node,
      style: { ...node.style, width: updated.width ?? defaultNodeWidth(updated), height: updated.height ?? defaultNodeHeight(updated), zIndex: updated.z_index },
      data: {
        ...node.data,
        ...updated,
        media_assets: preserveExistingMedia && updated.media_assets.length === 0 && node.data.media_assets.length > 0 ? node.data.media_assets : updated.media_assets,
        onOpenMedia: openMedia,
        onObjectChange: patch => objectChange(updated.id, patch),
      },
    } : node))
    setBoard(current => current ? {
      ...current,
      nodes: current.nodes.map(node => node.id === updated.id ? {
        ...updated,
        media_assets: preserveExistingMedia && updated.media_assets.length === 0 && node.media_assets.length > 0 ? node.media_assets : updated.media_assets,
      } : node),
    } : current)
    setSelected(current => current?.id === updated.id ? {
      ...updated,
      media_assets: preserveExistingMedia && updated.media_assets.length === 0 && current.media_assets.length > 0 ? current.media_assets : updated.media_assets,
    } : current)
  }, [objectChange, openMedia, setNodes])
  const setLayer = async (ids: number[], direction: 'front' | 'back') => {
    if (!board || !ids.length) return
    const selectedSet = new Set(ids)
    const targets = board.nodes.filter(node => selectedSet.has(node.id)).sort((a, b) => a.z_index - b.z_index || a.id - b.id)
    const boundary = direction === 'front' ? Math.max(0, ...board.nodes.map(node => node.z_index)) : Math.min(0, ...board.nodes.map(node => node.z_index))
    const start = direction === 'front' ? boundary + 1 : boundary - targets.length
    try {
      const saved = await Promise.all(targets.map((node, index) => api.updateNode(node.id, { z_index: start + index })))
      saved.forEach(node => replaceNode(node))
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось изменить порядок слоёв') }
  }
  const syncNode = useCallback(async (id: string, data: Partial<MemoryNode>) => {
    try {
      const saved = await api.updateNode(Number(id), data)
      setNodes(current => current.map(node => node.id === id ? {
        ...node,
        ...(() => {
          const merged = { ...saved, ...node.data, ...data }
          return {
            position: { x: data.position_x ?? node.position.x, y: data.position_y ?? node.position.y },
            style: { ...node.style, width: merged.width ?? node.style?.width, height: merged.height ?? node.style?.height, zIndex: merged.z_index },
            data: { ...node.data, ...merged, onOpenMedia: openMedia, onObjectChange: patch => objectChange(saved.id, patch) },
          }
        })(),
      } : node))
      setBoard(current => current ? { ...current, nodes: current.nodes.map(node => node.id === saved.id ? { ...saved, ...node, ...data } : node) } : current)
      setSelected(current => current?.id === saved.id ? { ...saved, ...current, ...data } : current)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось сохранить изменения') }
  }, [objectChange, openMedia, setNodes])
  useEffect(() => () => Object.values(objectSyncTimersRef.current).forEach(timer => clearTimeout(timer)), [])
  objectChangeRef.current = (id, patch) => {
    const numericId = Number(id)
    setNodes(current => current.map(node => node.id === id ? { ...node, data: { ...node.data, ...patch } } : node))
    setBoard(current => current ? { ...current, nodes: current.nodes.map(node => node.id === numericId ? { ...node, ...patch } : node) } : current)
    setSelected(current => current?.id === numericId ? { ...current, ...patch } : current)
    const previous = objectSyncPatchesRef.current[id]
    const pending = { ...previous, ...patch }
    if (patch.object_data) pending.object_data = { ...(previous?.object_data || {}), ...patch.object_data }
    else if (previous?.object_data) pending.object_data = previous.object_data
    else delete pending.object_data
    objectSyncPatchesRef.current[id] = pending
    clearTimeout(objectSyncTimersRef.current[id])
    objectSyncTimersRef.current[id] = setTimeout(() => {
      const pending = objectSyncPatchesRef.current[id]
      delete objectSyncPatchesRef.current[id]
      delete objectSyncTimersRef.current[id]
      if (pending) void syncNode(id, pending)
    }, 180)
  }
  const onNodesChange = useCallback((changes: NodeChange<FlowMemoryNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current))
    const resizedPositions = new Map<string, { x: number; y: number }>()
    for (const change of changes) {
      if (change.type === 'position' && change.position) resizedPositions.set(change.id, change.position)
    }
    for (const change of changes) {
      if (change.type === 'dimensions' && !change.resizing && change.dimensions) {
        const node = nodesRef.current.find(item => item.id === change.id)
        const position = resizedPositions.get(change.id) ?? node?.position
        if (node && !['canvas_text', 'canvas_image'].includes(node.data.type) && (node.data.width !== change.dimensions.width || node.data.height !== change.dimensions.height)) void syncNode(change.id, { width: change.dimensions.width, height: change.dimensions.height, position_x: position?.x, position_y: position?.y })
      }
    }
  }, [setNodes, syncNode])
  const onConnect: OnConnect = useCallback(async (connection: Connection) => {
    if (!board || !connection.source || !connection.target) return
    try {
      const saved = await api.createEdge(board.id, Number(connection.source), Number(connection.target), connection.sourceHandle, connection.targetHandle)
      setEdges(old => addEdge(toFlowEdge(saved), old))
      setBoard(current => current ? { ...current, edges: [...current.edges, saved] } : current)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось создать связь') }
  }, [board, setEdges])
  const setConnectionCandidate = useCallback((candidateId: string | null) => {
    if (connectionCandidateRef.current === candidateId) return
    connectionCandidateRef.current = candidateId
    setNodes(current => current.map(node => ({ ...node, data: { ...node.data, isConnecting: node.id === candidateId } })))
  }, [setNodes])
  const onConnectionPointerMove = useCallback((event: React.MouseEvent) => {
    const sourceId = connectionSourceRef.current
    if (!sourceId) return
    const cursor = screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const closest = nodesRef.current.reduce<{ id: string; distance: number } | null>((best, node) => {
      if (node.id === sourceId) return best
      const width = Number(node.measured?.width ?? node.width ?? node.style?.width ?? 0)
      const height = Number(node.measured?.height ?? node.height ?? node.style?.height ?? 0)
      const centerX = node.position.x + width / 2
      const centerY = node.position.y + height / 2
      const distance = (centerX - cursor.x) ** 2 + (centerY - cursor.y) ** 2
      return !best || distance < best.distance ? { id: node.id, distance } : best
    }, null)
    setConnectionCandidate(closest?.id ?? null)
  }, [screenToFlowPosition, setConnectionCandidate])
  const onEdgesDelete = useCallback(async (deleted: Edge[]) => {
    await Promise.all(deleted.map(edge => api.deleteEdge(Number(edge.id))))
    setEdges(current => current.filter(edge => !deleted.some(item => Number(item.id) === Number(edge.id))))
    setBoard(current => current ? { ...current, edges: current.edges.filter(edge => !deleted.some(item => Number(item.id) === edge.id)) } : current)
    setSelectedEdgeIds([])
  }, [setEdges])
  const onSelectionChange = useCallback(({ nodes: selection, edges: edgeSelection }: { nodes: FlowMemoryNode[]; edges: Edge[] }) => {
    const ids = selection.map(node => Number(node.id))
    const edgeIds = edgeSelection.map(edge => Number(edge.id))
    const sameNodes = ids.length === selectionRef.current.length && ids.every((id, index) => id === selectionRef.current[index])
    const sameEdges = edgeIds.length === edgeSelectionRef.current.length && edgeIds.every((id, index) => id === edgeSelectionRef.current[index])
    if (sameNodes && sameEdges) return
    selectionRef.current = ids
    edgeSelectionRef.current = edgeIds
    setSelectedIds(ids)
    setSelectedEdgeIds(edgeIds)
    setSelected(ids.length === 1 ? selection[0].data : null)
  }, [])
  const create = async (type: NodeType, position?: { x: number; y: number }, source?: Partial<MemoryNode>) => {
    if (!board) return null
    try {
      const index = nodes.length
      const media = type === 'media'
      const node = await api.createNode(board.id, {
        type, title: source?.title || '', text_content: source?.text_content,
        position_x: position?.x ?? 100 + index * 40, position_y: position?.y ?? 120 + index * 30, z_index: Math.max(0, ...nodes.map(item => item.data.z_index)) + 1,
        width: source?.width ?? (media ? 300 : type === 'note' ? 230 : type === 'canvas_text' ? 380 : type === 'canvas_image' ? 260 : undefined), height: source?.height ?? (media ? 260 : type === 'canvas_text' ? 100 : type === 'canvas_image' ? 260 : undefined),
        temporal_date: source?.temporal_date,
        show_date: source?.show_date ?? true, show_type_label: source?.show_type_label ?? false, date_position: source?.date_position ?? 'bottom-center', title_position: source?.title_position ?? 'bottom-center',
        track_data: type === 'track' ? source?.track_data || { title: '', artist: '', kind: 'track', cover_size: 'small', playlist_items: [], collapsed_item_limit: 3, show_timeline: false, duration_seconds: 0, hide_details: false } : undefined,
        object_data: source?.object_data ?? (type === 'canvas_text' ? { text: 'Текст', font_size: 42, font_family: "Inter, 'Segoe UI', Arial, sans-serif" } : undefined),
      })
      setNodes(current => [...current.map(item => ({ ...item, selected: false })), { ...toFlowNode(node, openMedia, patch => objectChange(node.id, patch), togglePlaylistOpen, theme), selected: true }])
      setBoard(current => current ? { ...current, nodes: [...current.nodes, node] } : current)
      selectionRef.current = [node.id]
      setSelected(node); setSelectedIds([node.id])
      return node
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось создать узел') }
    return null
  }
  const createPng = async (file: File, position: { x: number; y: number }) => {
    try {
      const node = await create('canvas_image', position)
      if (node) { await api.upload(node.id, file); replaceNode(await api.node(node.id)) }
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось добавить PNG') }
  }
  const clipboardPosition = () => {
    const pointer = canvasPointerRef.current
    const bounds = canvasRef.current?.getBoundingClientRect()
    return screenToFlowPosition(pointer || (bounds ? { x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 } : { x: window.innerWidth / 2, y: window.innerHeight / 2 }))
  }
  const uploadPastedMedia = async (node: MemoryNode, files: File[]) => {
    const errors: string[] = []
    for (const [index, file] of files.entries()) {
      const extension = clipboardMediaExtensions[file.type]
      const uploadFile = file.name ? file : new File([file], `clipboard-${index + 1}.${extension}`, { type: file.type })
      try { await api.upload(node.id, uploadFile) }
      catch (error) { errors.push(error instanceof Error ? error.message : 'Не удалось загрузить файл') }
    }
    try { replaceNode(await api.node(node.id)) }
    catch (error) { errors.push(error instanceof Error ? error.message : 'Не удалось обновить медиа') }
    if (errors.length) setNotice(errors.join('\n'))
  }
  const pasteMedia = async (files: File[]) => {
    const selectedMedia = selectedRef.current?.type === 'media' ? selectedRef.current : null
    if (selectedMedia) { await uploadPastedMedia(selectedMedia, files); return }
    const node = await create('media', clipboardPosition())
    if (node) await uploadPastedMedia(node, files)
  }
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('input, textarea, select, [contenteditable="true"]')) return
      const clipboardData = event.clipboardData
      if (!clipboardData) return
      const pastedMedia = Array.from(clipboardData.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null && file.type in clipboardMediaExtensions)
      if (pastedMedia.length) {
        event.preventDefault()
        void pasteMedia(pastedMedia)
        return
      }
      const hasUnsupportedMedia = Array.from(clipboardData.items).some(item => item.kind === 'file' && (item.type.startsWith('image/') || item.type.startsWith('video/')))
      if (hasUnsupportedMedia) {
        event.preventDefault()
        setNotice('Поддерживаются JPEG, PNG, WebP, GIF, MP4, WebM и MOV')
        return
      }
      const text = clipboardData.getData('text/plain')
      if (text) {
        event.preventDefault()
        void create('note', clipboardPosition(), { text_content: text })
      }
    }
    document.addEventListener('paste', onPaste, true)
    return () => document.removeEventListener('paste', onPaste, true)
  }, [board, nodes, screenToFlowPosition])
  const save = async (draft: Partial<MemoryNode>, files: File[] = []) => {
    if (!selected) return
    const updated = await api.updateNode(selected.id, { title: draft.title, text_content: draft.text_content, temporal_date: draft.temporal_date, show_date: draft.show_date, show_type_label: draft.show_type_label, date_position: draft.date_position, track_data: draft.track_data, object_data: draft.object_data })
    // Metadata saves must not erase a file that was uploaded concurrently.
    replaceNode(updated, true)
    const errors: string[] = []
    for (const file of files) {
      try { await api.upload(updated.id, file) }
      catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : 'не удалось загрузить файл'}`) }
      finally { try { replaceNode(await api.node(updated.id)) } catch (refreshError) { errors.push(`Не удалось обновить список файлов: ${refreshError instanceof Error ? refreshError.message : 'повторите попытку'}`) } }
    }
    if (errors.length) throw new Error(errors.join('\n'))
  }
  const preview = (draft: Partial<MemoryNode>) => {
    if (!selected) return
    setNodes(current => current.map(node => node.id === String(selected.id) ? { ...node, data: { ...node.data, ...draft, track_data: draft.track_data ? { ...draft.track_data } : node.data.track_data } } : node))
  }
  const remove = async () => {
    if (!selectedIds.length) return
    const ids = new Set(selectedIds)
    await Promise.all([...ids].map(id => api.deleteNode(id)))
    setNodes(current => current.filter(node => !ids.has(Number(node.id))))
    setEdges(current => current.filter(edge => !ids.has(Number(edge.source)) && !ids.has(Number(edge.target))))
    setBoard(current => current ? { ...current, nodes: current.nodes.filter(node => !ids.has(node.id)), edges: current.edges.filter(edge => !ids.has(edge.source_node_id) && !ids.has(edge.target_node_id)) } : current)
    setSelected(null); setSelectedIds([])
  }
  const duplicate = async (source: MemoryNode) => {
    if ((source.type !== 'media' && source.type !== 'canvas_image') || !board) return create(source.type, { x: source.position_x + 40, y: source.position_y + 40 }, source)
    try {
      const node = await api.duplicateMediaNode(source.id, { position_x: source.position_x + 40, position_y: source.position_y + 40, z_index: Math.max(0, ...nodes.map(item => item.data.z_index)) + 1 })
      setNodes(current => [...current.map(item => ({ ...item, selected: false })), { ...toFlowNode(node, openMedia, patch => objectChange(node.id, patch), togglePlaylistOpen, theme), selected: true }])
      setBoard(current => current ? { ...current, nodes: [...current.nodes, node] } : current)
      selectionRef.current = [node.id]
      setSelected(node); setSelectedIds([node.id])
      return node
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось дублировать медиа') }
    return null
  }
  const toggleImageFlip = (nodeId: number, axis: 'flip_x' | 'flip_y') => {
    const node = board?.nodes.find(item => item.id === nodeId)
    if (!node || node.type !== 'canvas_image') return
    objectChange(node.id, { object_data: { ...(node.object_data || {}), [axis]: !node.object_data?.[axis] } })
  }
  const openContextMenu = (event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }, nodeId?: number, edgeIds?: number[]) => {
    event.preventDefault(); event.stopPropagation()
    const activeNodeIds = contextSelectionRef.current.nodeIds.length ? contextSelectionRef.current.nodeIds : selectionRef.current
    const activeEdgeIds = contextSelectionRef.current.edgeIds.length ? contextSelectionRef.current.edgeIds : edgeSelectionRef.current
    const nodeIds = nodeId && activeNodeIds.length > 1 && activeNodeIds.includes(nodeId) ? activeNodeIds : nodeId ? [nodeId] : activeNodeIds.length > 1 ? activeNodeIds : undefined
    const contextEdgeIds = edgeIds?.length && activeEdgeIds.length > 1 && edgeIds.some(id => activeEdgeIds.includes(id)) ? activeEdgeIds : edgeIds
    if (nodeId && nodeIds?.length === 1) { const node = board?.nodes.find(item => item.id === nodeId) || null; setSelected(node); setSelectedIds([nodeId]); setSelectedEdgeIds([]) }
    if (contextEdgeIds?.length) { setSelected(null); setSelectedIds([]); setSelectedEdgeIds(contextEdgeIds) }
    setContextMenu({ x: event.clientX, y: event.clientY, nodeId, nodeIds, edgeIds: contextEdgeIds })
  }
  const removeAsset = async (asset: Asset) => {
    if (!selected) return
    try { await api.deleteMedia(asset.id); replaceNode({ ...selected, media_assets: selected.media_assets.filter(item => item.id !== asset.id) }) }
    catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось удалить файл') }
  }
  const updateAsset = async (asset: Asset, patch: Partial<Pick<Asset, 'is_favorite' | 'sort_order'>>) => {
    if (!selected) return
    try {
      const updated = await api.updateMedia(asset.id, patch)
      replaceNode({ ...selected, media_assets: selected.media_assets.map(item => item.id === updated.id ? updated : item).sort((a, b) => a.sort_order - b.sort_order) })
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось обновить файл') }
  }
  const reorderAssets = async (assets: Asset[]) => {
    if (!selected) return
    try {
      const saved = await Promise.all(assets.map((asset, index) => api.updateMedia(asset.id, { sort_order: index })))
      replaceNode({ ...selected, media_assets: saved.sort((a, b) => a.sort_order - b.sort_order) })
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось изменить порядок') }
  }
  const closeEditor = () => {
    if (selected && board) {
      const persisted = board.nodes.find(node => node.id === selected.id)
      if (persisted) setNodes(current => current.map(node => node.id === String(persisted.id) ? { ...node, data: { ...node.data, ...persisted, onOpenMedia: openMedia } } : node))
    }
    setSelected(null)
  }
  const days = useMemo(() => {
    if (!board) return []
    const dates: string[] = []; const current = new Date(`${board.start_date}T00:00:00`); const end = new Date(`${board.end_date}T00:00:00`)
    while (current <= end) { dates.push(toDateKey(current)); current.setDate(current.getDate() + 1) }
    return dates
  }, [board])
  if (loading) return <main className="loading">Открываем MemoryBox…</main>
  if (!board) return <main className="loading error">{notice || 'Доска недоступна'}</main>
  const activeAsset = lightbox?.assets[lightbox.index]
  const dotSize = Math.min(9, Math.max(1.35, 1.7 / zoom))

  return <main className={`app theme-${theme}`} onClick={() => setContextMenu(null)}>
    <header><div><input aria-label="Название доски" value={board.title} onChange={event => setBoard({ ...board, title: event.target.value })} onBlur={async () => { try { await api.renameBoard(board.id, board.title) } catch { setNotice('Не удалось сохранить название') } }} /></div><div className="header-actions"><button className="theme-toggle" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>{theme === 'dark' ? '☀' : '☾'}</button><button className="boards-link" onClick={onHome}>Все доски</button></div></header>
    {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <input ref={imageInputRef} className="visually-hidden" type="file" accept="image/png,.png" onChange={event => { const file = event.target.files?.[0]; const position = pendingImagePositionRef.current; event.currentTarget.value = ''; if (file && position) void createPng(file, position) }} />
    <section ref={canvasRef} className="canvas-wrap" onPointerMoveCapture={event => { canvasPointerRef.current = { x: event.clientX, y: event.clientY } }} onMouseDownCapture={event => { if (event.button === 2) contextSelectionRef.current = { nodeIds: nodes.filter(node => node.selected).map(node => Number(node.id)), edgeIds: edges.filter(edge => edge.selected).map(edge => Number(edge.id)) } }} onContextMenuCapture={event => { const target = event.target as HTMLElement; const nodeElement = target.closest<HTMLElement>('.react-flow__node'); const edgeElement = target.closest<HTMLElement>('.react-flow__edge'); const nodeId = Number(nodeElement?.dataset.id); const edgeId = Number(edgeElement?.dataset.id); openContextMenu(event, Number.isFinite(nodeId) ? nodeId : undefined, Number.isFinite(edgeId) ? [edgeId] : undefined) }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onEdgesDelete={onEdgesDelete} onSelectionChange={onSelectionChange} onNodeClick={(_, node) => { setSelected(node.data); setSelectedIds([Number(node.id)]); setSelectedEdgeIds([]) }} onEdgeClick={(_, edge) => { setSelectedEdgeIds([Number(edge.id)]); setSelected(null); setSelectedIds([]) }} onNodeContextMenu={(event, node) => openContextMenu(event, Number(node.id))} onEdgeContextMenu={(event, edge) => { const id = Number(edge.id); openContextMenu(event, undefined, selectedEdgeIds.length > 1 && selectedEdgeIds.includes(id) ? selectedEdgeIds : [id]) }} onPaneContextMenu={event => openContextMenu(event)} onPaneClick={() => { setSelected(null); setSelectedIds([]); setSelectedEdgeIds([]) }} onNodeDragStop={(_, node) => void syncNode(node.id, { position_x: node.position.x, position_y: node.position.y })} onConnectStart={(_, params) => { connectionSourceRef.current = params.nodeId; setConnectionCandidate(null) }} onConnectEnd={() => { connectionSourceRef.current = null; setConnectionCandidate(null) }} onMouseMove={onConnectionPointerMove} onConnect={onConnect} onMove={(_, viewport) => { if (Math.abs(viewport.zoom - zoomRef.current) >= 0.02) { zoomRef.current = viewport.zoom; setZoom(viewport.zoom) } }} nodeTypes={nodeTypes} edgeTypes={edgeTypes} deleteKeyCode={null} connectionMode={ConnectionMode.Loose} connectionRadius={32} proOptions={{ hideAttribution: true }} onlyRenderVisibleElements minZoom={0.2} maxZoom={2} defaultEdgeOptions={{ type: 'memory' }}>
        <Background variant={BackgroundVariant.Dots} color={theme === 'light' ? '#d2cadb' : '#484252'} gap={20} size={dotSize} />
      </ReactFlow>
      <div className="timeline"><span>{formatPeriod(board)}</span><div className="timeline-scroll" onWheel={event => { if (event.deltaY) { event.currentTarget.scrollLeft += event.deltaY; event.preventDefault() } }}><div className="timeline-days">{days.map(date => { const datedNodes = board.nodes.filter(node => node.temporal_date === date); const bookmarks = datedNodes.length < 2 ? [] : datedNodes.filter((_, index) => index % 2 === 0).slice(0, 5); const day = Number(date.slice(8)); return <i key={date}><b className="timeline-bookmarks">{bookmarks.map((node, index) => <em key={node.id} className={`timeline-bookmark ${node.type}`} style={{ bottom: index * 9 }} title={node.title || node.track_data?.title || 'Воспоминание'} />)}</b><small>{day}</small></i> })}</div></div></div>
    </section>
    {selected && ['note', 'media', 'track', 'canvas_text', 'canvas_image'].includes(selected.type) && <Editor node={selected} boardStartDate={board.start_date} boardEndDate={board.end_date} theme={theme} onClose={closeEditor} onSave={save} onRequestDelete={() => setDeleteDialog(true)} onDeleteAsset={removeAsset} onUpdateAsset={updateAsset} onReorderAssets={reorderAssets} onPreview={preview} onTextChange={object_data => objectChange(selected.id, { object_data })} onTextPreview={fontFamily => previewTextFont(selected.id, fontFamily)} onCreate={create} />}
    {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={event => event.stopPropagation()}>
      {contextMenu.edgeIds?.length ? <><p>{contextMenu.edgeIds.length > 1 ? 'Связи' : 'Связь'}</p><button className="context-danger" onClick={() => { void onEdgesDelete(edges.filter(edge => contextMenu.edgeIds?.includes(Number(edge.id)))); setContextMenu(null) }}>Удалить {contextMenu.edgeIds.length > 1 ? 'связи' : 'связь'}</button></>
        : contextMenu.nodeIds && contextMenu.nodeIds.length > 1 ? <><p>Выбрано: {contextMenu.nodeIds.length}</p><button onClick={() => { void setLayer(contextMenu.nodeIds || [], 'front'); setContextMenu(null) }}>На передний план</button><button onClick={() => { void setLayer(contextMenu.nodeIds || [], 'back'); setContextMenu(null) }}>На задний план</button><button className="context-danger" onClick={() => { setDeleteDialog(true); setContextMenu(null) }}>Удалить выбранные</button></>
          : contextMenu.nodeId ? <><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) setClipboard(node); setContextMenu(null) }}>Копировать</button><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) { setClipboard(node); setSelectedIds([node.id]); void remove() } setContextMenu(null) }}>Вырезать</button><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) void duplicate(node); setContextMenu(null) }}>Дублировать</button>{board.nodes.find(item => item.id === contextMenu.nodeId)?.type === 'canvas_image' && <><button onClick={() => { toggleImageFlip(contextMenu.nodeId!, 'flip_x'); setContextMenu(null) }}>Отзеркалить по горизонтали</button><button onClick={() => { toggleImageFlip(contextMenu.nodeId!, 'flip_y'); setContextMenu(null) }}>Отзеркалить по вертикали</button></>}<button onClick={() => { void setLayer([contextMenu.nodeId!], 'front'); setContextMenu(null) }}>На передний план</button><button onClick={() => { void setLayer([contextMenu.nodeId!], 'back'); setContextMenu(null) }}>На задний план</button></>
            : <>{clipboard && <button onClick={() => { const point = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y }); void create(clipboard.type, point, clipboard); setContextMenu(null) }}>Вставить</button>}<p>Создать</p><button onClick={() => { void create('note', screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y })); setContextMenu(null) }}>Заметку</button><button onClick={() => { void create('media', screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y })); setContextMenu(null) }}>Медиакарточку</button><button onClick={() => { void create('track', screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y })); setContextMenu(null) }}>Музыку</button><button onClick={() => { void create('canvas_text', screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y })); setContextMenu(null) }}>Текст</button><button onClick={() => { pendingImagePositionRef.current = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y }); imageInputRef.current?.click(); setContextMenu(null) }}>Изображение</button></>}
    </div>}
    {deleteDialog && selectedIds.length > 0 && <div className="confirm-backdrop"><div className="confirm-dialog"><p className="eyebrow">Удаление</p><h2>Удалить {selectedIds.length > 1 ? 'выбранные воспоминания' : 'воспоминание'}?</h2><p>Карточки, их файлы и связи будут удалены.</p><div><button onClick={() => setDeleteDialog(false)}>Отмена</button><button ref={confirmButton} className="confirm-delete" onClick={() => { setDeleteDialog(false); void remove() }}>Подтвердить</button></div></div></div>}
    {activeAsset && <div className="lightbox" onClick={() => setLightbox(null)}><button className="lightbox-close" onClick={() => setLightbox(null)}>×</button>{lightbox.assets.length > 1 && <button className="lightbox-nav prev" onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index: (current.index - 1 + current.assets.length) % current.assets.length } : current) }}>‹</button>}<div className="lightbox-content" onClick={event => event.stopPropagation()} key={activeAsset.id}>{activeAsset.mime_type.startsWith('image/') ? <img src={mediaUrl(activeAsset.storage_path)} alt={activeAsset.original_filename} /> : <video src={mediaUrl(activeAsset.storage_path)} controls autoPlay />}</div>{lightbox.assets.length > 1 && <button className="lightbox-nav next" onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index: (current.index + 1) % current.assets.length } : current) }}>›</button>}<div className="lightbox-footer"><p>{activeAsset.original_filename} {lightbox.assets.length > 1 && `• ${lightbox.index + 1}/${lightbox.assets.length}`}</p>{lightbox.assets.length > 1 && <div className="lightbox-thumbs">{lightbox.assets.map((asset, index) => <button key={asset.id} className={index === lightbox.index ? 'active' : ''} onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index } : current) }}>{asset.mime_type.startsWith('image/') ? <img src={mediaUrl(asset.preview_path || asset.storage_path)} alt={asset.original_filename} /> : <video src={mediaUrl(asset.storage_path)} muted preload="metadata" />}</button>)}</div>}</div></div>}
  </main>
}

type BoardSort = 'date' | 'duration'
type BoardContextMenuView = 'actions' | 'title' | 'period' | 'icon'
const boardFolderIconsStorageKey = 'memorybox-board-folder-icons'
const boardDurationDays = (board: Pick<Board, 'start_date' | 'end_date'>) => Math.max(0, Math.round((new Date(`${board.end_date}T00:00:00`).getTime() - new Date(`${board.start_date}T00:00:00`).getTime()) / 86_400_000) + 1)
const boardFolderIconModules = import.meta.glob('./assets/board-folders/**/*.{webp,png,jpg,jpeg,svg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const boardFolderIcons = Object.entries(boardFolderIconModules).map(([path, url]) => {
  const relativePath = path.replace('./assets/board-folders/', '')
  const parts = relativePath.split('/')
  const filename = parts.pop() || ''
  return {
    id: path,
    url,
    directory: parts.join('/'),
    label: filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || 'Папка',
  }
}).sort((left, right) => left.id.localeCompare(right.id, 'ru'))
const defaultBoardFolderIconId = boardFolderIcons.find(icon => icon.label === 'macos blue')?.id || boardFolderIcons[0]?.id || ''

function BoardHome({ onOpen, theme, onToggleTheme }: { onOpen: (id: number) => void; theme: Theme; onToggleTheme: () => void }) {
  const [boards, setBoards] = useState<Board[]>([])
  const [title, setTitle] = useState('')
  const initialDate = todayKey()
  const [startDate, setStartDate] = useState(initialDate)
  const [endDate, setEndDate] = useState(initialDate)
  const [editingBoard, setEditingBoard] = useState<Board | null>(null)
  const [boardContextMenuView, setBoardContextMenuView] = useState<BoardContextMenuView>('actions')
  const [boardToDelete, setBoardToDelete] = useState<Board | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [deletingBoard, setDeletingBoard] = useState(false)
  const [sort, setSort] = useState<BoardSort>('date')
  const [folderIconsByBoard, setFolderIconsByBoard] = useState<Record<string, string>>(() => {
    try { const saved = JSON.parse(window.localStorage.getItem(boardFolderIconsStorageKey) || '{}'); return saved && typeof saved === 'object' && !Array.isArray(saved) ? saved : {} }
    catch { return {} }
  })
  const [editingFolderIconId, setEditingFolderIconId] = useState(defaultBoardFolderIconId)
  const [folderIconPickerOpen, setFolderIconPickerOpen] = useState(false)
  const [folderIconDirectory, setFolderIconDirectory] = useState('')
  const loadBoards = useCallback(async () => {
    try {
      const next = await api.boards()
      setBoards(next)
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить доски') }
  }, [])
  useEffect(() => { void loadBoards() }, [loadBoards])
  useEffect(() => {
    if (!editingBoard) return
    const closeOnOutsidePress = (event: MouseEvent) => {
      const target = event.target
      if (target instanceof Element && target.closest('.board-context-menu, .board-card-settings')) return
      setEditingBoard(null)
      setFolderIconPickerOpen(false)
      setBoardContextMenuView('actions')
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      setEditingBoard(null)
      setFolderIconPickerOpen(false)
      setBoardContextMenuView('actions')
    }
    document.addEventListener('mousedown', closeOnOutsidePress)
    document.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOnOutsidePress)
      document.removeEventListener('keydown', closeOnEscape)
    }
  }, [editingBoard])
  useEffect(() => { window.localStorage.setItem(boardFolderIconsStorageKey, JSON.stringify(folderIconsByBoard)) }, [folderIconsByBoard])
  const createBoard = async (event: React.FormEvent) => {
    event.preventDefault()
    if (creating) return
    setCreating(true); setError('')
    try {
      const board = await api.createBoard({ title: title.trim() || `${formatDate(startDate)} — ${formatDate(endDate)}`, start_date: startDate, end_date: endDate })
      setBoards(current => [board, ...current])
      setFolderIconsByBoard(current => ({ ...current, [String(board.id)]: defaultBoardFolderIconId }))
      setTitle('')
    }
    catch (createError) { setError(createError instanceof Error ? createError.message : 'Не удалось создать доску') }
    finally { setCreating(false) }
  }
  const saveBoardSettings = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!editingBoard || savingSettings) return
    setSavingSettings(true); setError('')
    try {
      const title = editingBoard.title.trim() || `${formatDate(editingBoard.start_date)} — ${formatDate(editingBoard.end_date)}`
      const saved = await api.updateBoard(editingBoard.id, { title, start_date: editingBoard.start_date, end_date: editingBoard.end_date })
      setBoards(current => current.map(board => board.id === saved.id ? { ...board, ...saved } : board))
      setFolderIconsByBoard(current => ({ ...current, [String(editingBoard.id)]: editingFolderIconId }))
      setFolderIconPickerOpen(false)
      setBoardContextMenuView('actions')
      setEditingBoard(null)
    } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить настройки') }
    finally { setSavingSettings(false) }
  }
  const deleteBoard = async () => {
    if (!boardToDelete || deletingBoard) return
    setDeletingBoard(true); setError('')
    try {
      await api.deleteBoard(boardToDelete.id)
      setBoards(current => current.filter(board => board.id !== boardToDelete.id))
      setFolderIconsByBoard(current => { const next = { ...current }; delete next[String(boardToDelete.id)]; return next })
      setBoardToDelete(null)
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить доску') }
    finally { setDeletingBoard(false) }
  }
  const sortedBoards = useMemo(() => sort === 'date'
    ? [...boards].sort((left, right) => right.start_date.localeCompare(left.start_date) || right.end_date.localeCompare(left.end_date))
    : [...boards].sort((left, right) => boardDurationDays(right) - boardDurationDays(left) || right.start_date.localeCompare(left.start_date)), [boards, sort])
  const folderIconForBoard = (boardId: number) => boardFolderIcons.find(icon => icon.id === folderIconsByBoard[String(boardId)]) || boardFolderIcons.find(icon => icon.id === defaultBoardFolderIconId) || boardFolderIcons[0]
  const folderIconEntries = useMemo(() => {
    const prefix = folderIconDirectory ? `${folderIconDirectory}/` : ''
    const directories = [...new Set(boardFolderIcons
      .filter(icon => icon.directory.startsWith(prefix) && icon.directory !== folderIconDirectory)
      .map(icon => icon.directory.slice(prefix.length).split('/')[0])
      .filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ru')).map(name => {
      const fullPath = `${prefix}${name}`
      return { name, cover: boardFolderIcons.find(icon => icon.directory === fullPath || icon.directory.startsWith(`${fullPath}/`)) }
    })
    return { directories, icons: boardFolderIcons.filter(icon => icon.directory === folderIconDirectory) }
  }, [folderIconDirectory])
  return (
    <main className={`board-home theme-${theme}`}>
      <header className="home-window-bar">
        <div className="home-window-title"><span className="home-window-app-icon">◆</span><p className="home-logo">MEMORYBOX</p></div>
        <div className="header-actions"><button className="theme-toggle" onClick={onToggleTheme} aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'} title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}>{theme === 'dark' ? '☀' : '☾'}</button></div>
      </header>
      <section className="board-home-content">
        <form className="new-board" onSubmit={createBoard}>
          <div className="new-board-titlebar"><div className="new-board-window-controls" aria-hidden="true"><i /><i /><i /></div><span>Создание доски</span></div>
          <div className="new-board-body">
            <p className="eyebrow">Новая доска</p>
            <h2>Начать новый период</h2>
            <label>Название<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Например, Поездка в Карелию" autoFocus /></label>
            <div className="new-board-date"><label>Начало<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label>Конец<input type="date" min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div>
            {error && <p className="error">{error}</p>}
            <div className="new-board-footer"><button className="new-board-submit" disabled={creating}>{creating ? 'Создаю…' : 'Создать доску'}</button></div>
          </div>
        </form>
        <div className="board-library">
          <div className="board-library-heading">
            <p className="eyebrow">Ваши доски</p>
            <div className="board-library-controls">
              <label>Сортировка<select value={sort} onChange={event => setSort(event.target.value as BoardSort)}><option value="date">По дате</option><option value="duration">По длительности</option></select></label>
              <span>{boards.length}</span>
            </div>
          </div>
          {boards.length ? <div className="board-grid">{sortedBoards.map(board => {
            const folderIcon = folderIconForBoard(board.id)
            const resetBoardContextMenu = () => {
              setEditingBoard({ ...board })
              setEditingFolderIconId(folderIcon?.id || defaultBoardFolderIconId)
              setFolderIconPickerOpen(false)
              setFolderIconDirectory('')
              setBoardContextMenuView('actions')
            }
            const toggleBoardContextMenu = () => {
              if (editingBoard?.id !== board.id) return resetBoardContextMenu()
              setEditingBoard(null)
              setFolderIconPickerOpen(false)
              setBoardContextMenuView('actions')
            }
            return <article className="board-card" key={board.id} style={folderIcon ? { backgroundImage: `url("${folderIcon.url}")` } : undefined}>
              <button className="board-card-open" onClick={() => onOpen(board.id)} aria-label={`Открыть доску «${board.title}»`} />
              <div className="board-card-caption">
                <button className="board-card-title" onClick={() => onOpen(board.id)}>{board.title}</button>
                <button className={`board-card-settings ${editingBoard?.id === board.id ? 'active' : ''}`} aria-label={`Настроить доску «${board.title}»`} aria-pressed={editingBoard?.id === board.id} title="Настроить доску" onClick={toggleBoardContextMenu}>⚙</button>
              </div>
              {editingBoard?.id === board.id && <form className="board-context-menu" onSubmit={saveBoardSettings}>
                {boardContextMenuView === 'actions' && <>
                  <p>Доска</p>
                  <button type="button" className="board-context-menu-item" onClick={() => setBoardContextMenuView('title')}>Изменить название</button>
                  <button type="button" className="board-context-menu-item" onClick={() => setBoardContextMenuView('period')}>Изменить период</button>
                  <button type="button" className="board-context-menu-item" onClick={() => { setFolderIconPickerOpen(true); setFolderIconDirectory(''); setBoardContextMenuView('icon') }}>Изменить иконку</button>
                  <span className="board-context-menu-divider" />
                  <button type="button" className="board-context-menu-item danger" onClick={() => { setBoardToDelete(editingBoard); setEditingBoard(null); setFolderIconPickerOpen(false); setBoardContextMenuView('actions') }}>Удалить доску</button>
                </>}
                {boardContextMenuView === 'title' && <>
                  <button type="button" className="board-context-menu-back" onClick={resetBoardContextMenu}>← Назад</button>
                  <label>Название<input value={editingBoard.title} onChange={event => setEditingBoard({ ...editingBoard, title: event.target.value })} autoFocus /></label>
                  <div className="board-context-menu-actions"><button type="button" onClick={resetBoardContextMenu}>Отмена</button><button className="primary" disabled={savingSettings}>{savingSettings ? 'Сохраняю…' : 'Сохранить'}</button></div>
                </>}
                {boardContextMenuView === 'period' && <>
                  <button type="button" className="board-context-menu-back" onClick={resetBoardContextMenu}>← Назад</button>
                  <div className="new-board-date"><label>Начало<input type="date" value={editingBoard.start_date} onChange={event => setEditingBoard({ ...editingBoard, start_date: event.target.value })} /></label><label>Конец<input type="date" min={editingBoard.start_date} value={editingBoard.end_date} onChange={event => setEditingBoard({ ...editingBoard, end_date: event.target.value })} /></label></div>
                  <div className="board-context-menu-actions"><button type="button" onClick={resetBoardContextMenu}>Отмена</button><button className="primary" disabled={savingSettings}>{savingSettings ? 'Сохраняю…' : 'Сохранить'}</button></div>
                </>}
                {boardContextMenuView === 'icon' && <>
                  <button type="button" className="board-context-menu-back" onClick={resetBoardContextMenu}>← Назад</button>
                  <p className="board-context-menu-heading">Иконка папки</p>
                  {folderIconPickerOpen && <div className="folder-icon-browser">
                    {folderIconDirectory && <button type="button" className="folder-icon-back" onClick={() => setFolderIconDirectory(current => current.split('/').slice(0, -1).join('/'))}>← Назад</button>}
                    <div className="folder-icon-options">
                      {folderIconEntries.directories.map(directory => <button type="button" key={directory.name} className="folder-icon-directory" onClick={() => setFolderIconDirectory(current => current ? `${current}/${directory.name}` : directory.name)} title={`Открыть папку «${directory.name}»`}>{directory.cover && <img src={directory.cover.url} alt="" />}<span>{directory.name}</span></button>)}
                      {folderIconEntries.icons.map(icon => <button type="button" key={icon.id} className={icon.id === editingFolderIconId ? 'selected' : ''} onClick={() => setEditingFolderIconId(icon.id)} title={icon.label}><img src={icon.url} alt="" /><span>{icon.label}</span></button>)}
                    </div>
                  </div>}
                  <div className="board-context-menu-actions"><button type="button" onClick={resetBoardContextMenu}>Отмена</button><button className="primary" disabled={savingSettings}>{savingSettings ? 'Сохраняю…' : 'Сохранить'}</button></div>
                </>}
              </form>}
            </article>
          })}</div> : <p className="board-empty">Создайте первую доску — она появится здесь.</p>}
        </div>
      </section>
      {boardToDelete && <div className="confirm-backdrop"><div className="confirm-dialog"><p className="eyebrow">Удаление доски</p><h2>Удалить «{boardToDelete.title}»?</h2><p>Все карточки, связи и загруженные файлы этой доски будут удалены без возможности восстановления.</p><div><button onClick={() => setBoardToDelete(null)} disabled={deletingBoard}>Отмена</button><button className="confirm-delete" onClick={() => void deleteBoard()} disabled={deletingBoard}>{deletingBoard ? 'Удаляю…' : 'Удалить доску'}</button></div></div></div>}
    </main>
  )
}

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  const [theme, setTheme] = useState<Theme>(() => window.localStorage.getItem('memorybox-theme') === 'light' ? 'light' : 'dark')
  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState) }, [])
  useEffect(() => { window.localStorage.setItem('memorybox-theme', theme); document.documentElement.dataset.theme = theme }, [theme])
  const openBoard = useCallback((id: number) => { const next = `/boards/${id}`; window.history.pushState({}, '', next); setPath(next) }, [])
  const openHome = useCallback(() => { window.history.pushState({}, '', '/'); setPath('/') }, [])
  const match = path.match(/^\/boards\/(\d+)$/)
  const toggleTheme = useCallback(() => setTheme(current => current === 'dark' ? 'light' : 'dark'), [])
  return match ? <ReactFlowProvider><BoardCanvas boardId={Number(match[1])} onHome={openHome} theme={theme} onToggleTheme={toggleTheme} /></ReactFlowProvider> : <BoardHome onOpen={openBoard} theme={theme} onToggleTheme={toggleTheme} />
}
