import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addEdge, applyNodeChanges, Background, BackgroundVariant, Connection, Edge, NodeChange, OnConnect, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react'
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
const toFlowNode = (node: MemoryNode, onOpenMedia: (assets: Asset[], index: number) => void): FlowMemoryNode => ({
  id: String(node.id), type: 'memory', position: { x: node.position_x, y: node.position_y },
  style: { width: node.width ?? (node.type === 'media' ? 300 : 230), height: node.height ?? (node.type === 'media' ? 260 : undefined), zIndex: node.z_index },
  data: { ...node, onOpenMedia },
})
const toFlowEdge = (edge: MemoryEdge): Edge => ({
  id: String(edge.id), type: 'bezier', source: String(edge.source_node_id), target: String(edge.target_node_id), label: edge.label || undefined,
  style: { stroke: '#a38dcc', strokeWidth: 1.6, strokeLinecap: 'round' },
})

function BoardCanvas({ boardId, onHome }: { boardId: number; onHome: () => void }) {
  const { screenToFlowPosition } = useReactFlow()
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
  const confirmButton = useRef<HTMLButtonElement>(null)
  const nodesRef = useRef(nodes)
  const selectionRef = useRef<number[]>([])
  const edgeSelectionRef = useRef<number[]>([])
  const contextSelectionRef = useRef<{ nodeIds: number[]; edgeIds: number[] }>({ nodeIds: [], edgeIds: [] })
  const zoomRef = useRef(1)

  const openMedia = useCallback((assets: Asset[], index: number) => setLightbox({ assets, index }), [])
  const load = useCallback(async () => {
    try {
      const next = await api.board(boardId)
      setBoard(next)
      setNodes(next.nodes.map(node => toFlowNode(node, openMedia)))
      setEdges(next.edges.map(toFlowEdge))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось загрузить холст')
    } finally { setLoading(false) }
  }, [boardId, openMedia, setEdges, setNodes])

  useEffect(() => { load() }, [load])
  useEffect(() => { nodesRef.current = nodes }, [nodes])
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
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && clipboard) { event.preventDefault(); void duplicate(clipboard); return }
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

  const replaceNode = useCallback((updated: MemoryNode) => {
    setNodes(list => list.map(node => node.id === String(updated.id) ? {
      ...node,
      style: { ...node.style, width: updated.width ?? (updated.type === 'media' ? 300 : 230), height: updated.height ?? (updated.type === 'media' ? 260 : undefined), zIndex: updated.z_index },
      data: { ...updated, onOpenMedia: openMedia },
    } : node))
    setBoard(current => current ? { ...current, nodes: current.nodes.map(node => node.id === updated.id ? updated : node) } : current)
    setSelected(current => current?.id === updated.id ? updated : current)
  }, [openMedia, setNodes])
  const setLayer = async (ids: number[], direction: 'front' | 'back') => {
    if (!board || !ids.length) return
    const selectedSet = new Set(ids)
    const targets = board.nodes.filter(node => selectedSet.has(node.id)).sort((a, b) => a.z_index - b.z_index || a.id - b.id)
    const boundary = direction === 'front' ? Math.max(0, ...board.nodes.map(node => node.z_index)) : Math.min(0, ...board.nodes.map(node => node.z_index))
    const start = direction === 'front' ? boundary + 1 : boundary - targets.length
    try {
      const saved = await Promise.all(targets.map((node, index) => api.updateNode(node.id, { z_index: start + index })))
      saved.forEach(replaceNode)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось изменить порядок слоёв') }
  }
  const syncNode = useCallback(async (id: string, data: Partial<MemoryNode>) => {
    try {
      const saved = await api.updateNode(Number(id), data)
      setNodes(current => current.map(node => node.id === id ? {
        ...node, position: { x: saved.position_x, y: saved.position_y },
        style: { ...node.style, width: saved.width ?? node.style?.width, height: saved.height ?? node.style?.height, zIndex: saved.z_index },
        data: { ...node.data, position_x: saved.position_x, position_y: saved.position_y, z_index: saved.z_index, width: saved.width, height: saved.height },
      } : node))
      setBoard(current => current ? { ...current, nodes: current.nodes.map(node => node.id === saved.id ? { ...node, position_x: saved.position_x, position_y: saved.position_y, z_index: saved.z_index, width: saved.width, height: saved.height } : node) } : current)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось сохранить изменения') }
  }, [setNodes])
  const onNodesChange = useCallback((changes: NodeChange<FlowMemoryNode>[]) => {
    setNodes(current => applyNodeChanges(changes, current))
    for (const change of changes) {
      if (change.type === 'dimensions' && !change.resizing && change.dimensions) {
        const node = nodesRef.current.find(item => item.id === change.id)
        if (node && (node.data.width !== change.dimensions.width || node.data.height !== change.dimensions.height)) void syncNode(change.id, { width: change.dimensions.width, height: change.dimensions.height })
      }
    }
  }, [setNodes, syncNode])
  const onConnect: OnConnect = useCallback(async (connection: Connection) => {
    if (!board || !connection.source || !connection.target) return
    try {
      const saved = await api.createEdge(board.id, Number(connection.source), Number(connection.target))
      setEdges(old => addEdge(toFlowEdge(saved), old))
      setBoard(current => current ? { ...current, edges: [...current.edges, saved] } : current)
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось создать связь') }
  }, [board, setEdges])
  const setConnectionHandles = useCallback((isConnecting: boolean) => {
    setNodes(current => current.map(node => ({ ...node, data: { ...node.data, isConnecting } })))
  }, [setNodes])
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
  const create = async (type: NodeType, position?: { x: number; y: number }, source?: MemoryNode) => {
    if (!board) return
    try {
      const index = nodes.length
      const media = type === 'media'
      const node = await api.createNode(board.id, {
        type, title: source?.title || '', text_content: source?.text_content,
        position_x: position?.x ?? 100 + index * 40, position_y: position?.y ?? 120 + index * 30, z_index: Math.max(0, ...nodes.map(item => item.data.z_index)) + 1,
        width: source?.width ?? (media ? 300 : type === 'note' ? 230 : undefined), height: source?.height ?? (media ? 260 : undefined),
        temporal_date: source?.temporal_date,
        track_data: type === 'track' ? source?.track_data || { title: '', artist: '', kind: 'track', cover_size: 'small', playlist_items: [], collapsed_item_limit: 3 } : undefined,
      })
      setNodes(current => [...current.map(item => ({ ...item, selected: false })), { ...toFlowNode(node, openMedia), selected: true }])
      setBoard(current => current ? { ...current, nodes: [...current.nodes, node] } : current)
      selectionRef.current = [node.id]
      setSelected(node); setSelectedIds([node.id])
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось создать узел') }
  }
  const save = async (draft: Partial<MemoryNode>, files: File[] = []) => {
    if (!selected) return
    const updated = await api.updateNode(selected.id, { title: draft.title, text_content: draft.text_content, temporal_date: draft.temporal_date, track_data: draft.track_data })
    replaceNode(updated)
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
  const duplicate = async (source: MemoryNode) => create(source.type, { x: source.position_x + 40, y: source.position_y + 40 }, source)
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
      if (persisted) setNodes(current => current.map(node => node.id === String(persisted.id) ? { ...node, data: { ...persisted, onOpenMedia: openMedia } } : node))
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

  return <main className="app" onClick={() => setContextMenu(null)}>
    <header><div><input aria-label="Название доски" value={board.title} onChange={event => setBoard({ ...board, title: event.target.value })} onBlur={async () => { try { await api.renameBoard(board.id, board.title) } catch { setNotice('Не удалось сохранить название') } }} /></div><button className="boards-link" onClick={onHome}>Все доски</button></header>
    {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <section className="canvas-wrap" onMouseDownCapture={event => { if (event.button === 2) contextSelectionRef.current = { nodeIds: nodes.filter(node => node.selected).map(node => Number(node.id)), edgeIds: edges.filter(edge => edge.selected).map(edge => Number(edge.id)) } }} onContextMenuCapture={event => { const target = event.target as HTMLElement; const nodeElement = target.closest<HTMLElement>('.react-flow__node'); const edgeElement = target.closest<HTMLElement>('.react-flow__edge'); const nodeId = Number(nodeElement?.dataset.id); const edgeId = Number(edgeElement?.dataset.id); openContextMenu(event, Number.isFinite(nodeId) ? nodeId : undefined, Number.isFinite(edgeId) ? [edgeId] : undefined) }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onEdgesDelete={onEdgesDelete} onSelectionChange={onSelectionChange} onNodeClick={(_, node) => { setSelected(node.data); setSelectedIds([Number(node.id)]); setSelectedEdgeIds([]) }} onEdgeClick={(_, edge) => { setSelectedEdgeIds([Number(edge.id)]); setSelected(null); setSelectedIds([]) }} onNodeContextMenu={(event, node) => openContextMenu(event, Number(node.id))} onEdgeContextMenu={(event, edge) => { const id = Number(edge.id); openContextMenu(event, undefined, selectedEdgeIds.length > 1 && selectedEdgeIds.includes(id) ? selectedEdgeIds : [id]) }} onPaneContextMenu={event => openContextMenu(event)} onPaneClick={() => { setSelected(null); setSelectedIds([]); setSelectedEdgeIds([]) }} onNodeDragStop={(_, node) => void syncNode(node.id, { position_x: node.position.x, position_y: node.position.y })} onConnectStart={() => setConnectionHandles(true)} onConnectEnd={() => setConnectionHandles(false)} onConnect={onConnect} onMove={(_, viewport) => { if (Math.abs(viewport.zoom - zoomRef.current) >= 0.02) { zoomRef.current = viewport.zoom; setZoom(viewport.zoom) } }} nodeTypes={nodeTypes} deleteKeyCode={null} connectionRadius={32} proOptions={{ hideAttribution: true }} onlyRenderVisibleElements fitView minZoom={0.2} maxZoom={2} defaultEdgeOptions={{ type: 'bezier' }}>
        <Background variant={BackgroundVariant.Dots} color="#484252" gap={20} size={dotSize} />
      </ReactFlow>
      <div className="timeline"><span>{formatPeriod(board)}</span><div className="timeline-scroll" onWheel={event => { if (event.deltaY) { event.currentTarget.scrollLeft += event.deltaY; event.preventDefault() } }}><div className="timeline-days">{days.map(date => { const datedNodes = board.nodes.filter(node => node.temporal_date === date).slice(0, 5); const day = Number(date.slice(8)); return <i key={date}><b className="timeline-bookmarks">{datedNodes.map((node, index) => <em key={node.id} className={`timeline-bookmark ${node.type}`} style={{ bottom: index * 9 }} title={node.title || node.track_data?.title || 'Воспоминание'} />)}</b><small>{day}</small></i> })}</div></div></div>
    </section>
    <Editor node={selected} boardStartDate={board.start_date} boardEndDate={board.end_date} onClose={closeEditor} onSave={save} onRequestDelete={() => setDeleteDialog(true)} onDeleteAsset={removeAsset} onUpdateAsset={updateAsset} onReorderAssets={reorderAssets} onPreview={preview} onCreate={create} />
    {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={event => event.stopPropagation()}>{contextMenu.edgeIds?.length ? <><p>{contextMenu.edgeIds.length > 1 ? 'Связи' : 'Связь'}</p><button className="context-danger" onClick={() => { void onEdgesDelete(edges.filter(edge => contextMenu.edgeIds?.includes(Number(edge.id)))); setContextMenu(null) }}>Удалить {contextMenu.edgeIds.length > 1 ? 'связи' : 'связь'}</button></> : contextMenu.nodeIds && contextMenu.nodeIds.length > 1 ? <><p>Выбрано: {contextMenu.nodeIds.length}</p><button onClick={() => { void setLayer(contextMenu.nodeIds || [], 'front'); setContextMenu(null) }}>На передний план</button><button onClick={() => { void setLayer(contextMenu.nodeIds || [], 'back'); setContextMenu(null) }}>На задний план</button><button className="context-danger" onClick={() => { setDeleteDialog(true); setContextMenu(null) }}>Удалить выбранные</button></> : contextMenu.nodeId ? <><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) setClipboard(node); setContextMenu(null) }}>Копировать</button><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) { setClipboard(node); setSelectedIds([node.id]); void remove() } setContextMenu(null) }}>Вырезать</button><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) void duplicate(node); setContextMenu(null) }}>Дублировать</button><button onClick={() => { void setLayer([contextMenu.nodeId!], 'front'); setContextMenu(null) }}>На передний план</button><button onClick={() => { void setLayer([contextMenu.nodeId!], 'back'); setContextMenu(null) }}>На задний план</button></> : <>{clipboard && <button onClick={() => { const point = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y }); void create(clipboard.type, point, clipboard); setContextMenu(null) }}>Вставить</button>}<p>Создать</p>{(['note', 'media', 'track'] as NodeType[]).map(type => <button key={type} onClick={() => { const point = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y }); void create(type, point); setContextMenu(null) }}>{type === 'note' ? 'Заметку' : type === 'media' ? 'Медиа' : 'Музыку'}</button>)}</>}</div>}
    {deleteDialog && selectedIds.length > 0 && <div className="confirm-backdrop"><div className="confirm-dialog"><p className="eyebrow">Удаление</p><h2>Удалить {selectedIds.length > 1 ? 'выбранные воспоминания' : 'воспоминание'}?</h2><p>Карточки, их файлы и связи будут удалены.</p><div><button onClick={() => setDeleteDialog(false)}>Отмена</button><button ref={confirmButton} className="confirm-delete" onClick={() => { setDeleteDialog(false); void remove() }}>Подтвердить</button></div></div></div>}
    {activeAsset && <div className="lightbox" onClick={() => setLightbox(null)}><button className="lightbox-close" onClick={() => setLightbox(null)}>×</button>{lightbox.assets.length > 1 && <button className="lightbox-nav prev" onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index: (current.index - 1 + current.assets.length) % current.assets.length } : current) }}>‹</button>}<div className="lightbox-content" onClick={event => event.stopPropagation()} key={activeAsset.id}>{activeAsset.mime_type.startsWith('image/') ? <img src={mediaUrl(activeAsset.storage_path)} alt={activeAsset.original_filename} /> : <video src={mediaUrl(activeAsset.storage_path)} controls autoPlay />}</div>{lightbox.assets.length > 1 && <button className="lightbox-nav next" onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index: (current.index + 1) % current.assets.length } : current) }}>›</button>}<div className="lightbox-footer"><p>{activeAsset.original_filename} {lightbox.assets.length > 1 && `• ${lightbox.index + 1}/${lightbox.assets.length}`}</p>{lightbox.assets.length > 1 && <div className="lightbox-thumbs">{lightbox.assets.map((asset, index) => <button key={asset.id} className={index === lightbox.index ? 'active' : ''} onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index } : current) }}>{asset.mime_type.startsWith('image/') ? <img src={mediaUrl(asset.preview_path || asset.storage_path)} alt={asset.original_filename} /> : <video src={mediaUrl(asset.storage_path)} muted preload="metadata" />}</button>)}</div>}</div></div>}
  </main>
}

function BoardHome({ onOpen }: { onOpen: (id: number) => void }) {
  const [boards, setBoards] = useState<Board[]>([])
  const [title, setTitle] = useState('')
  const initialDate = todayKey()
  const [startDate, setStartDate] = useState(initialDate)
  const [endDate, setEndDate] = useState(initialDate)
  const [editingBoard, setEditingBoard] = useState<Board | null>(null)
  const [boardToDelete, setBoardToDelete] = useState<Board | null>(null)
  const [error, setError] = useState('')
  const [creating, setCreating] = useState(false)
  const [savingSettings, setSavingSettings] = useState(false)
  const [deletingBoard, setDeletingBoard] = useState(false)
  const loadBoards = useCallback(async () => { try { setBoards(await api.boards()) } catch (loadError) { setError(loadError instanceof Error ? loadError.message : 'Не удалось загрузить доски') } }, [])
  useEffect(() => { void loadBoards() }, [loadBoards])
  const createBoard = async (event: React.FormEvent) => {
    event.preventDefault()
    if (creating) return
    setCreating(true); setError('')
    try { const board = await api.createBoard({ title: title.trim() || `${formatDate(startDate)} — ${formatDate(endDate)}`, start_date: startDate, end_date: endDate }); onOpen(board.id) }
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
      setBoardToDelete(null)
    } catch (deleteError) { setError(deleteError instanceof Error ? deleteError.message : 'Не удалось удалить доску') }
    finally { setDeletingBoard(false) }
  }
  return <main className="board-home"><header><div><p className="home-logo">MEMORYBOX</p></div></header><section className="board-home-content"><form className="new-board" onSubmit={createBoard}><p className="eyebrow">Новая доска</p><h2>Начать новый период</h2><label>Название<input value={title} onChange={event => setTitle(event.target.value)} placeholder="Например, Поездка в Карелию" autoFocus /></label><div className="new-board-date"><label>С<input type="date" value={startDate} onChange={event => setStartDate(event.target.value)} /></label><label>По<input type="date" min={startDate} value={endDate} onChange={event => setEndDate(event.target.value)} /></label></div>{error && <p className="error">{error}</p>}<button className="new-board-submit" disabled={creating}>{creating ? 'Создаю…' : 'Создать доску'}</button></form><div className="board-library"><div className="board-library-heading"><p className="eyebrow">Ваши доски</p><span>{boards.length}</span></div>{boards.length ? <div className="board-grid">{boards.map(board => <article className="board-card" key={board.id}><button className="board-card-open" onClick={() => onOpen(board.id)}><span className="board-card-dates"><time>{formatDate(board.start_date)}</time>{board.start_date !== board.end_date && <time>{formatDate(board.end_date)}</time>}</span><strong>{board.title}</strong><small>Открыть холст</small></button><button className="board-card-settings" aria-label={`Настроить доску «${board.title}»`} title="Настроить доску" onClick={() => setEditingBoard({ ...board })}>⚙</button></article>)}</div> : <p className="board-empty">Создайте первую доску — она появится здесь.</p>}</div></section>{editingBoard && <div className="confirm-backdrop" onMouseDown={() => setEditingBoard(null)}><form className="board-settings" onMouseDown={event => event.stopPropagation()} onSubmit={saveBoardSettings}><p className="eyebrow">Настройки доски</p><h2>Период и название</h2><label>Название<input value={editingBoard.title} onChange={event => setEditingBoard({ ...editingBoard, title: event.target.value })} autoFocus /></label><div className="new-board-date"><label>С<input type="date" value={editingBoard.start_date} onChange={event => setEditingBoard({ ...editingBoard, start_date: event.target.value })} /></label><label>По<input type="date" min={editingBoard.start_date} value={editingBoard.end_date} onChange={event => setEditingBoard({ ...editingBoard, end_date: event.target.value })} /></label></div><div><button type="button" className="danger" onClick={() => { setBoardToDelete(editingBoard); setEditingBoard(null) }}>Удалить доску</button><span /><button type="button" onClick={() => setEditingBoard(null)}>Отмена</button><button className="primary" disabled={savingSettings}>{savingSettings ? 'Сохраняю…' : 'Сохранить'}</button></div></form></div>}{boardToDelete && <div className="confirm-backdrop"><div className="confirm-dialog"><p className="eyebrow">Удаление доски</p><h2>Удалить «{boardToDelete.title}»?</h2><p>Все карточки, связи и загруженные файлы этой доски будут удалены без возможности восстановления.</p><div><button onClick={() => setBoardToDelete(null)} disabled={deletingBoard}>Отмена</button><button className="confirm-delete" onClick={() => void deleteBoard()} disabled={deletingBoard}>{deletingBoard ? 'Удаляю…' : 'Удалить доску'}</button></div></div></div>}</main>
}

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  useEffect(() => { const onPopState = () => setPath(window.location.pathname); window.addEventListener('popstate', onPopState); return () => window.removeEventListener('popstate', onPopState) }, [])
  const openBoard = useCallback((id: number) => { const next = `/boards/${id}`; window.history.pushState({}, '', next); setPath(next) }, [])
  const openHome = useCallback(() => { window.history.pushState({}, '', '/'); setPath('/') }, [])
  const match = path.match(/^\/boards\/(\d+)$/)
  return match ? <ReactFlowProvider><BoardCanvas boardId={Number(match[1])} onHome={openHome} /></ReactFlowProvider> : <BoardHome onOpen={openBoard} />
}
