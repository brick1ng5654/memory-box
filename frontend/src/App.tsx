import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { addEdge, applyNodeChanges, Background, BackgroundVariant, Connection, Edge, NodeChange, OnConnect, ReactFlow, ReactFlowProvider, useEdgesState, useNodesState, useReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { api, Asset, Board, MemoryEdge, MemoryNode, NodeType, mediaUrl } from './api'
import MemoryCard, { FlowMemoryNode } from './MemoryCard'
import Editor from './Editor'

const nodeTypes = { memory: MemoryCard }
const toFlowNode = (node: MemoryNode, onOpenMedia: (assets: Asset[], index: number) => void): FlowMemoryNode => ({
  id: String(node.id), type: 'memory', position: { x: node.position_x, y: node.position_y },
  style: { width: node.width ?? (node.type === 'media' ? 300 : 230), height: node.type === 'media' ? node.height ?? 260 : undefined },
  data: { ...node, onOpenMedia },
})
const toFlowEdge = (edge: MemoryEdge): Edge => ({
  id: String(edge.id), type: 'bezier', source: String(edge.source_node_id), target: String(edge.target_node_id), label: edge.label || undefined,
  style: { stroke: '#a38dcc', strokeWidth: 1.6, strokeLinecap: 'round' },
})

function BoardCanvas() {
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
      const next = await api.board()
      setBoard(next)
      setNodes(next.nodes.map(node => toFlowNode(node, openMedia)))
      setEdges(next.edges.map(toFlowEdge))
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Не удалось загрузить холст')
    } finally { setLoading(false) }
  }, [openMedia, setEdges, setNodes])

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
      style: { ...node.style, width: updated.width ?? (updated.type === 'media' ? 300 : 230), height: updated.type === 'media' ? updated.height ?? 260 : undefined },
      data: { ...updated, onOpenMedia: openMedia },
    } : node))
    setBoard(current => current ? { ...current, nodes: current.nodes.map(node => node.id === updated.id ? updated : node) } : current)
    setSelected(current => current?.id === updated.id ? updated : current)
  }, [openMedia, setNodes])
  const syncNode = useCallback(async (id: string, data: Partial<MemoryNode>) => {
    try {
      const saved = await api.updateNode(Number(id), data)
      setNodes(current => current.map(node => node.id === id ? {
        ...node, position: { x: saved.position_x, y: saved.position_y },
        style: { ...node.style, width: saved.width ?? node.style?.width, height: saved.height ?? node.style?.height },
        data: { ...node.data, position_x: saved.position_x, position_y: saved.position_y, width: saved.width, height: saved.height },
      } : node))
      setBoard(current => current ? { ...current, nodes: current.nodes.map(node => node.id === saved.id ? { ...node, position_x: saved.position_x, position_y: saved.position_y, width: saved.width, height: saved.height } : node) } : current)
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
        position_x: position?.x ?? 100 + index * 40, position_y: position?.y ?? 120 + index * 30,
        width: media ? source?.width ?? 300 : undefined, height: media ? source?.height ?? 260 : undefined,
        temporal_date: source?.temporal_date,
        track_data: type === 'track' ? source?.track_data || { title: '', artist: '', kind: 'track', cover_size: 'small', playlist_items: [] } : undefined,
      })
      setNodes(current => [...current, toFlowNode(node, openMedia)])
      setBoard(current => current ? { ...current, nodes: [...current.nodes, node] } : current)
      setSelected(node); setSelectedIds([node.id])
    } catch (error) { setNotice(error instanceof Error ? error.message : 'Не удалось создать узел') }
  }
  const save = async (draft: Partial<MemoryNode>, files: File[] = []) => {
    if (!selected) return
    const updated = await api.updateNode(selected.id, { title: draft.title, text_content: draft.text_content, temporal_date: draft.temporal_date, track_data: draft.track_data })
    const errors: string[] = []
    for (const file of files) {
      try { await api.upload(updated.id, file) }
      catch (error) { errors.push(`${file.name}: ${error instanceof Error ? error.message : 'не удалось загрузить файл'}`) }
      finally { replaceNode(await api.node(updated.id)) }
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
  const days = useMemo(() => board ? Array.from({ length: new Date(board.year, board.month, 0).getDate() }, (_, index) => index + 1) : [], [board])
  if (loading) return <main className="loading">Открываем MemoryBox…</main>
  if (!board) return <main className="loading error">{notice || 'Доска недоступна'}</main>
  const activeAsset = lightbox?.assets[lightbox.index]
  const dotSize = Math.min(9, Math.max(1.35, 1.7 / zoom))

  return <main className="app" onClick={() => setContextMenu(null)}>
    <header><div><p className="eyebrow">ЛИЧНЫЙ ХОЛСТ</p><input aria-label="Название доски" value={board.title} onChange={event => setBoard({ ...board, title: event.target.value })} onBlur={async () => { try { await api.renameBoard(board.id, board.title) } catch { setNotice('Не удалось сохранить название') } }} /></div></header>
    {notice && <div className="notice">{notice}<button onClick={() => setNotice('')}>×</button></div>}
    <section className="canvas-wrap" onMouseDownCapture={event => { if (event.button === 2) contextSelectionRef.current = { nodeIds: nodes.filter(node => node.selected).map(node => Number(node.id)), edgeIds: edges.filter(edge => edge.selected).map(edge => Number(edge.id)) } }} onContextMenuCapture={event => { const target = event.target as HTMLElement; const nodeElement = target.closest<HTMLElement>('.react-flow__node'); const edgeElement = target.closest<HTMLElement>('.react-flow__edge'); const nodeId = Number(nodeElement?.dataset.id); const edgeId = Number(edgeElement?.dataset.id); openContextMenu(event, Number.isFinite(nodeId) ? nodeId : undefined, Number.isFinite(edgeId) ? [edgeId] : undefined) }}>
      <ReactFlow nodes={nodes} edges={edges} onNodesChange={onNodesChange} onEdgesChange={onEdgesChange} onEdgesDelete={onEdgesDelete} onSelectionChange={onSelectionChange} onNodeClick={(_, node) => { setSelected(node.data); setSelectedIds([Number(node.id)]); setSelectedEdgeIds([]) }} onEdgeClick={(_, edge) => { setSelectedEdgeIds([Number(edge.id)]); setSelected(null); setSelectedIds([]) }} onNodeContextMenu={(event, node) => openContextMenu(event, Number(node.id))} onEdgeContextMenu={(event, edge) => { const id = Number(edge.id); openContextMenu(event, undefined, selectedEdgeIds.length > 1 && selectedEdgeIds.includes(id) ? selectedEdgeIds : [id]) }} onPaneContextMenu={event => openContextMenu(event)} onPaneClick={() => { setSelected(null); setSelectedIds([]); setSelectedEdgeIds([]) }} onNodeDragStop={(_, node) => void syncNode(node.id, { position_x: node.position.x, position_y: node.position.y })} onConnectStart={() => setConnectionHandles(true)} onConnectEnd={() => setConnectionHandles(false)} onConnect={onConnect} onMove={(_, viewport) => { if (Math.abs(viewport.zoom - zoomRef.current) >= 0.02) { zoomRef.current = viewport.zoom; setZoom(viewport.zoom) } }} nodeTypes={nodeTypes} deleteKeyCode={null} connectionRadius={32} proOptions={{ hideAttribution: true }} onlyRenderVisibleElements fitView minZoom={0.2} maxZoom={2} defaultEdgeOptions={{ type: 'bezier' }}>
        <Background variant={BackgroundVariant.Dots} color="#484252" gap={20} size={dotSize} />
      </ReactFlow>
      <div className="timeline"><span>Июль {board.year}</span><div>{days.map(day => { const date = `${board.year}-${String(board.month).padStart(2, '0')}-${String(day).padStart(2, '0')}`; const datedNodes = board.nodes.filter(node => node.temporal_date === date).slice(0, 5); return <i key={day}><b className="timeline-bookmarks">{datedNodes.map(node => <em key={node.id} className={`timeline-bookmark ${node.type}`} title={node.title || node.track_data?.title || 'Воспоминание'} />)}</b><small>{day}</small></i> })}</div></div>
    </section>
    <Editor node={selected} boardYear={board.year} boardMonth={board.month} onClose={closeEditor} onSave={save} onRequestDelete={() => setDeleteDialog(true)} onDeleteAsset={removeAsset} onUpdateAsset={updateAsset} onReorderAssets={reorderAssets} onPreview={preview} onCreate={create} />
    {contextMenu && <div className="context-menu" style={{ left: contextMenu.x, top: contextMenu.y }} onClick={event => event.stopPropagation()}>{contextMenu.edgeIds?.length ? <><p>{contextMenu.edgeIds.length > 1 ? 'Связи' : 'Связь'}</p><button className="context-danger" onClick={() => { void onEdgesDelete(edges.filter(edge => contextMenu.edgeIds?.includes(Number(edge.id)))); setContextMenu(null) }}>Удалить {contextMenu.edgeIds.length > 1 ? 'связи' : 'связь'}</button></> : contextMenu.nodeIds && contextMenu.nodeIds.length > 1 ? <><p>Выбрано: {contextMenu.nodeIds.length}</p><button className="context-danger" onClick={() => { setDeleteDialog(true); setContextMenu(null) }}>Удалить выбранные</button></> : contextMenu.nodeId ? <><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) setClipboard(node); setContextMenu(null) }}>Копировать</button><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) { setClipboard(node); setSelectedIds([node.id]); void remove() } setContextMenu(null) }}>Вырезать</button><button onClick={() => { const node = board.nodes.find(item => item.id === contextMenu.nodeId); if (node) void duplicate(node); setContextMenu(null) }}>Дублировать</button></> : <>{clipboard && <button onClick={() => { const point = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y }); void create(clipboard.type, point, clipboard); setContextMenu(null) }}>Вставить</button>}<p>Создать</p>{(['note', 'media', 'track'] as NodeType[]).map(type => <button key={type} onClick={() => { const point = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y }); void create(type, point); setContextMenu(null) }}>{type === 'note' ? 'Заметку' : type === 'media' ? 'Медиа' : 'Музыку'}</button>)}</>}</div>}
    {deleteDialog && selectedIds.length > 0 && <div className="confirm-backdrop"><div className="confirm-dialog"><p className="eyebrow">Удаление</p><h2>Удалить {selectedIds.length > 1 ? 'выбранные воспоминания' : 'воспоминание'}?</h2><p>Карточки, их файлы и связи будут удалены.</p><div><button onClick={() => setDeleteDialog(false)}>Отмена</button><button ref={confirmButton} className="confirm-delete" onClick={() => { setDeleteDialog(false); void remove() }}>Подтвердить</button></div></div></div>}
    {activeAsset && <div className="lightbox" onClick={() => setLightbox(null)}><button className="lightbox-close" onClick={() => setLightbox(null)}>×</button>{lightbox.assets.length > 1 && <button className="lightbox-nav prev" onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index: (current.index - 1 + current.assets.length) % current.assets.length } : current) }}>‹</button>}<div className="lightbox-content" onClick={event => event.stopPropagation()} key={activeAsset.id}>{activeAsset.mime_type.startsWith('image/') ? <img src={mediaUrl(activeAsset.storage_path)} alt={activeAsset.original_filename} /> : <video src={mediaUrl(activeAsset.storage_path)} controls autoPlay />}</div>{lightbox.assets.length > 1 && <button className="lightbox-nav next" onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index: (current.index + 1) % current.assets.length } : current) }}>›</button>}<div className="lightbox-footer"><p>{activeAsset.original_filename} {lightbox.assets.length > 1 && `• ${lightbox.index + 1}/${lightbox.assets.length}`}</p>{lightbox.assets.length > 1 && <div className="lightbox-thumbs">{lightbox.assets.map((asset, index) => <button key={asset.id} className={index === lightbox.index ? 'active' : ''} onClick={event => { event.stopPropagation(); setLightbox(current => current ? { ...current, index } : current) }}>{asset.mime_type.startsWith('image/') ? <img src={mediaUrl(asset.preview_path || asset.storage_path)} alt={asset.original_filename} /> : <video src={mediaUrl(asset.storage_path)} muted preload="metadata" />}</button>)}</div>}</div></div>}
  </main>
}

export default function App() { return <ReactFlowProvider><BoardCanvas /></ReactFlowProvider> }
