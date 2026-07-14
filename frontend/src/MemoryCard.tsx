import { useEffect, useState } from 'react'
import { Handle, Node, NodeProps, NodeResizer, Position, useStore, useUpdateNodeInternals } from '@xyflow/react'
import { Asset, MemoryNode, mediaUrl } from './api'

const labels = { note: 'Заметка', media: 'Медиа', track: 'Музыка' }
const icons = { note: '✦', media: '◒', track: '♫' }
export type FlowData = MemoryNode & { onOpenMedia?: (assets: Asset[], index: number) => void; isConnecting?: boolean } & Record<string, unknown>
export type FlowMemoryNode = Node<FlowData, 'memory'>

function MediaTile({ asset, index, assets, onOpen }: { asset: Asset; index: number; assets: Asset[]; onOpen?: (assets: Asset[], index: number) => void }) {
  const src = mediaUrl(asset.preview_path || asset.storage_path)
  if (!src) return null
  return <button className="media-tile nodrag" onClick={event => { event.stopPropagation(); onOpen?.(assets, index) }} title="Открыть медиа">
    {asset.mime_type.startsWith('image/') ? <img className="card-media" src={src} alt={asset.original_filename} draggable={false} /> : <video className="card-media" src={src} muted preload="metadata" />}
  </button>
}

export default function MemoryCard({ data, selected, id }: NodeProps<FlowMemoryNode>) {
  const node = data
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const updateNodeInternals = useUpdateNodeInternals()
  const hasConnections = useStore(state => state.edges.some(edge => edge.source === id || edge.target === id))
  const isPlaylist = node.type === 'track' && node.track_data?.kind === 'playlist'
  const largeCover = node.type === 'track' && node.track_data?.cover_size === 'large'
  const coverUrl = node.track_data?.cover_url || node.track_data?.spotify_cover_url
  const showHandles = selected || hasConnections || node.isConnecting
  useEffect(() => { updateNodeInternals(id) }, [hasConnections, id, playlistOpen, node.isConnecting, selected, updateNodeInternals])
  return <div className={`memory-card ${node.type} ${largeCover ? 'music-large' : ''} ${selected ? 'selected' : ''}`}>
    {node.type === 'media' && <NodeResizer isVisible={selected} minWidth={220} minHeight={170} maxWidth={760} maxHeight={650} lineClassName="resize-line" handleClassName="resize-handle" />}
    <Handle className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="target" position={Position.Left} style={{ top: '50%', transform: 'translateY(-50%)' }} />
    <div className="card-kicker"><span>{icons[node.type]} {labels[node.type]}</span>{node.temporal_date && <time>{new Date(`${node.temporal_date}T00:00:00`).getDate()} июля</time>}</div>
    {node.type === 'media' && <MediaPreview assets={node.media_assets} onOpen={node.onOpenMedia} />}
    {node.type === 'track' && coverUrl && <img className="track-cover" src={coverUrl} alt="" />}
    {(node.type !== 'note' || node.title) && <h3>{node.title || (node.type === 'track' ? node.track_data?.title || 'Без названия' : 'Без названия')}</h3>}
    {node.type === 'note' && node.text_content && <p>{node.text_content}</p>}
    {node.type === 'track' && <p>{isPlaylist ? `${node.track_data?.playlist_items.length || 0} треков` : node.track_data?.artist || 'Исполнитель не указан'}</p>}
    {isPlaylist && <><button className="playlist-toggle nodrag" onClick={event => { event.stopPropagation(); setPlaylistOpen(value => !value) }}>{playlistOpen ? 'Свернуть' : 'Показать треки'}</button>{playlistOpen && <ul className="playlist-list nowheel nodrag" onWheel={event => event.stopPropagation()}>{node.track_data?.playlist_items.map((item, index) => <li key={`${item.title}-${index}`}><strong>{item.title || 'Без названия'}</strong>{item.artist && <span>{item.artist}</span>}</li>)}</ul>}</>}
    <Handle className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="source" position={Position.Right} style={{ top: '50%', transform: 'translateY(-50%)' }} />
  </div>
}

function MediaPreview({ assets, onOpen }: { assets: Asset[]; onOpen?: (assets: Asset[], index: number) => void }) {
  const favorites = assets.filter(asset => asset.is_favorite)
  const previewAssets = (favorites.length ? favorites : assets).slice(0, 4)
  return <div className={`media-gallery assets-${Math.min(previewAssets.length, 4)}`}>{previewAssets.map(asset => <MediaTile key={asset.id} asset={asset} index={assets.findIndex(item => item.id === asset.id)} assets={assets} onOpen={onOpen} />)}{previewAssets.length === 0 && <span className="empty-media">Добавьте фото или видео</span>}</div>
}
