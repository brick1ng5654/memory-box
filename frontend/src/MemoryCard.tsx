import { useEffect, useState } from 'react'
import { Handle, Node, NodeProps, NodeResizer, Position, useUpdateNodeInternals } from '@xyflow/react'
import { Asset, MemoryNode, PlaylistItem, mediaUrl } from './api'

const labels = { note: 'Заметка', media: 'Медиа', track: 'Музыка' }
const icons = { note: '✦', media: '◒', track: '♫' }
const formatNodeDate = (value: string) => new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${value}T00:00:00`))
const formatTrackDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
export type FlowData = MemoryNode & { onOpenMedia?: (assets: Asset[], index: number) => void; isConnecting?: boolean } & Record<string, unknown>
export type FlowMemoryNode = Node<FlowData, 'memory'>

function MediaTile({ asset, index, assets, onOpen }: { asset: Asset; index: number; assets: Asset[]; onOpen?: (assets: Asset[], index: number) => void }) {
  const src = mediaUrl(asset.preview_path || asset.storage_path)
  if (!src) return null
  return <button className="media-tile nodrag" onClick={event => { event.stopPropagation(); onOpen?.(assets, index) }} title="Открыть медиа">
    {asset.mime_type.startsWith('image/') ? <img className="card-media" src={src} alt={asset.original_filename} draggable={false} /> : <video className="card-media" src={src} muted preload="metadata" />}
  </button>
}

function PlaylistRows({ items, preview = false }: { items: PlaylistItem[]; preview?: boolean }) {
  if (!items.length) return null
  return <ul className={`playlist-list nowheel nodrag ${preview ? 'playlist-preview' : ''}`} onWheel={event => event.stopPropagation()}>
    {items.map((item, index) => <li key={`${item.title}-${item.artist}-${index}`}><strong>{item.title || 'Без названия'}</strong>{item.artist && <span>{item.artist}</span>}</li>)}
  </ul>
}

export default function MemoryCard({ data, selected, id }: NodeProps<FlowMemoryNode>) {
  const node = data
  const [playlistOpen, setPlaylistOpen] = useState(false)
  const updateNodeInternals = useUpdateNodeInternals()
  const isPlaylist = node.type === 'track' && node.track_data?.kind === 'playlist'
  const playlistItems = node.track_data?.playlist_items || []
  const playlistPreview = playlistItems.filter(item => item.is_favorite).slice(0, node.track_data?.collapsed_item_limit ?? 3)
  const largeCover = node.type === 'track' && node.track_data?.cover_size === 'large'
  const hideTrackDetails = node.type === 'track' && !isPlaylist && node.track_data?.hide_details === true
  const coverPath = node.track_data?.cover_url || (isPlaylist ? playlistItems[0]?.cover_url : node.track_data?.spotify_cover_url)
  const coverUrl = coverPath?.startsWith('http') ? coverPath : mediaUrl(coverPath)
  const hideTitle = (node.type === 'media' && !node.title) || (isPlaylist && !node.track_data?.title)
  const showHandles = selected || node.isConnecting
  const datePosition = node.date_position || 'bottom-center'
  const dateSpaceClass = node.show_date && node.temporal_date ? datePosition.startsWith('top') ? 'has-top-date' : 'has-bottom-date' : ''
  const titlePosition = node.title_position || 'bottom-center'
  const mediaTitleClass = node.type === 'media' && node.title ? `has-media-title title-${titlePosition}` : ''
  useEffect(() => { updateNodeInternals(id) }, [id, playlistOpen, node.isConnecting, selected, updateNodeInternals])

  return <div className={`memory-card ${node.type} ${isPlaylist ? 'playlist-card' : ''} ${largeCover ? 'music-large' : ''} ${hideTrackDetails ? 'cover-only' : ''} ${node.height ? 'sized' : ''} ${node.show_type_label ? 'has-type-label' : ''} ${dateSpaceClass} ${mediaTitleClass} ${selected ? 'selected' : ''}`}>
    {(node.type === 'media' || node.type === 'note' || node.type === 'track') && <NodeResizer isVisible={selected} minWidth={node.type === 'media' ? 220 : node.type === 'track' ? isPlaylist && largeCover ? 320 : 280 : 180} minHeight={node.type === 'media' ? 170 : node.type === 'track' ? isPlaylist && largeCover ? 320 : isPlaylist ? 205 : largeCover ? 280 : 140 : 110} maxWidth={850} maxHeight={760} lineClassName="resize-line" handleClassName="resize-handle music-resize-handle" />}
    <Handle id="left" className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="source" position={Position.Left} isConnectableStart isConnectableEnd style={{ top: '50%', transform: 'translateY(-50%)' }} />
    {node.show_type_label && <span className="node-type-label">{icons[node.type]} {labels[node.type]}</span>}
    {node.show_date && node.temporal_date && <time className={`node-date ${datePosition}`}>{formatNodeDate(node.temporal_date)}</time>}
    {node.type === 'media' && <MediaPreview assets={node.media_assets} onOpen={node.onOpenMedia} />}
    {node.type === 'track' && (coverUrl ? <img className="track-cover" src={coverUrl} alt="" /> : <div className="track-cover track-cover-placeholder" aria-hidden="true">♪</div>)}
    {node.type === 'media' && !hideTitle && <h3 className={`media-title ${titlePosition}`}>{node.title}</h3>}
    {!isPlaylist && node.type === 'note' && !hideTitle && <h3>{node.title}</h3>}
    {node.type === 'note' && node.text_content && <p>{node.text_content}</p>}
    {node.type === 'track' && !isPlaylist && !hideTrackDetails && <div className="track-info">{!hideTitle && <h3>{node.track_data?.title || 'Без названия'}</h3>}<p>{node.track_data?.artist || 'Исполнитель не указан'}</p>{node.track_data?.show_timeline && <div className="track-timeline" aria-label={`Длительность ${formatTrackDuration(node.track_data.duration_seconds)}`}><span className="track-timeline-bar" /><time>{formatTrackDuration(node.track_data.duration_seconds)}</time></div>}</div>}
    {isPlaylist && <div className="playlist-summary">
      {!hideTitle && <h3>{node.track_data?.title}</h3>}
      <p>{playlistItems.length} треков</p>
      <button className="playlist-toggle nodrag" onClick={event => { event.stopPropagation(); setPlaylistOpen(value => !value) }}>{playlistOpen ? 'Скрыть треки' : 'Показать треки'}</button>
    </div>}
    {isPlaylist && <PlaylistRows items={playlistOpen ? playlistItems : playlistPreview} preview={!playlistOpen} />}
    <Handle id="right" className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="source" position={Position.Right} isConnectableStart isConnectableEnd style={{ top: '50%', transform: 'translateY(-50%)' }} />
  </div>
}

function MediaPreview({ assets, onOpen }: { assets: Asset[]; onOpen?: (assets: Asset[], index: number) => void }) {
  const favorites = assets.filter(asset => asset.is_favorite)
  const previewAssets = (favorites.length ? favorites : assets).slice(0, 4)
  return <div className={`media-gallery assets-${Math.min(previewAssets.length, 4)}`}>{previewAssets.map(asset => <MediaTile key={asset.id} asset={asset} index={assets.findIndex(item => item.id === asset.id)} assets={assets} onOpen={onOpen} />)}{previewAssets.length === 0 && <span className="empty-media">Добавьте фото или видео</span>}</div>
}
