import { useEffect, useRef } from 'react'
import { Handle, Node, NodeProps, NodeResizer, Position, useUpdateNodeInternals } from '@xyflow/react'
import { Asset, CanvasObjectData, MemoryNode, PlaylistItem, mediaUrl } from './api'
import { useLocalization } from './i18n'

const icons = { note: '✦', media: '◒', track: '♫', folder: '▱' }
const folderIconModules = import.meta.glob('./assets/board-folders/**/*.{webp,png,jpg,jpeg,svg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const defaultFolderIconUrl = Object.entries(folderIconModules).find(([path]) => path.toLowerCase().includes('macos-blue'))?.[1] || Object.values(folderIconModules)[0]
const formatNodeDate = (value: string, language: 'ru' | 'en') => new Intl.DateTimeFormat(language === 'en' ? 'en-US' : 'ru-RU', { day: 'numeric', month: 'long' }).format(new Date(`${value}T00:00:00`))
const formatTrackDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
const resizeLimits = (type: MemoryNode['type'], isPlaylist: boolean, largeCover: boolean) => {
  if (type === 'canvas_text') return { minWidth: 80, minHeight: 44 }
  if (type === 'canvas_image') return { minWidth: 80, minHeight: 80 }
  if (type === 'folder') return { minWidth: 150, minHeight: 110 }
  if (type === 'media') return { minWidth: 120, minHeight: 100 }
  if (type === 'note') return { minWidth: 120, minHeight: 80 }
  return { minWidth: isPlaylist && largeCover ? 180 : 150, minHeight: isPlaylist && largeCover ? 180 : largeCover ? 170 : 110 }
}
export type FlowData = MemoryNode & { onOpenMedia?: (assets: Asset[], index: number) => void; onObjectChange?: (patch: Partial<MemoryNode>) => void; onPlaylistToggle?: () => void; onFolderToggle?: () => void; playlistOpen?: boolean; isConnecting?: boolean; isFolderDropTarget?: boolean; previewObjectData?: CanvasObjectData; theme?: 'dark' | 'light' } & Record<string, unknown>
export type FlowMemoryNode = Node<FlowData, 'memory'>

function MediaTile({ asset, index, assets, onOpen }: { asset: Asset; index: number; assets: Asset[]; onOpen?: (assets: Asset[], index: number) => void }) {
  const { t } = useLocalization()
  const src = mediaUrl(asset.preview_path || asset.storage_path)
  if (!src) return null
  return <button className="media-tile nodrag" onClick={event => { event.stopPropagation(); onOpen?.(assets, index) }} title={t('Открыть медиа', 'Open media')}>
    {asset.mime_type.startsWith('image/') ? <img className="card-media" src={src} alt={asset.original_filename} draggable={false} /> : <video className="card-media" src={src} muted preload="metadata" />}
  </button>
}

function PlaylistRows({ items, preview = false }: { items: PlaylistItem[]; preview?: boolean }) {
  const { t } = useLocalization()
  if (!items.length) return null
  return <ul className={`playlist-list nowheel nodrag ${preview ? 'playlist-preview' : ''}`} onWheel={event => event.stopPropagation()}>
    {items.map((item, index) => <li key={`${item.title}-${item.artist}-${index}`}><strong>{item.title || t('Без названия', 'Untitled')}</strong>{item.artist && <span>{item.artist}</span>}</li>)}
  </ul>
}

export default function MemoryCard({ data, selected, id }: NodeProps<FlowMemoryNode>) {
  const { language, t } = useLocalization()
  const node = data
  const playlistOpen = node.playlistOpen ?? false
  const updateNodeInternals = useUpdateNodeInternals()
  const isPlaylist = node.type === 'track' && node.track_data?.kind === 'playlist'
  const playlistItems = node.track_data?.playlist_items || []
  const playlistPreview = playlistItems.filter(item => item.is_favorite).slice(0, node.track_data?.collapsed_item_limit ?? 3)
  const largeCover = node.type === 'track' && node.track_data?.cover_size === 'large'
  const hideTrackDetails = node.type === 'track' && !isPlaylist && node.track_data?.hide_details === true
  const coverPath = node.track_data?.cover_url || (isPlaylist ? playlistItems[0]?.cover_url : node.track_data?.spotify_cover_url)
  const coverUrl = coverPath?.startsWith('http') ? coverPath : mediaUrl(coverPath)
  const hideTitle = (node.type === 'media' && !node.title) || (isPlaylist && !node.track_data?.title)
  const showHandles = Boolean(selected || node.isConnecting)
  const datePosition = node.date_position || 'bottom-center'
  const dateSpaceClass = node.show_date && node.temporal_date ? datePosition.startsWith('top') ? 'has-top-date' : 'has-bottom-date' : ''
  const titlePosition = node.title_position || 'bottom-center'
  const mediaTitleClass = node.type === 'media' && node.title ? `has-media-title title-${titlePosition}` : ''
  const resizeLimit = resizeLimits(node.type, isPlaylist, largeCover)
  useEffect(() => { updateNodeInternals(id) }, [id, playlistOpen, node.isConnecting, selected, updateNodeInternals])

  if (node.type === 'folder') return <FolderNode node={node} selected={Boolean(selected)} />
  if (node.type === 'canvas_text' || node.type === 'canvas_image') return <CanvasObject node={node} selected={selected} resizeLimit={resizeLimit} />

  return <div className={`memory-card ${node.type} ${isPlaylist ? 'playlist-card' : ''} ${largeCover ? 'music-large' : ''} ${hideTrackDetails ? 'cover-only' : ''} ${node.height ? 'sized' : ''} ${node.show_type_label ? 'has-type-label' : ''} ${dateSpaceClass} ${mediaTitleClass} ${selected ? 'selected' : ''}`}>
    <NodeResizer isVisible={selected} {...resizeLimit} maxWidth={2400} maxHeight={1800} lineClassName="resize-line" handleClassName="resize-handle music-resize-handle" />
    <Handle id="left" className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="source" position={Position.Left} isConnectableStart isConnectableEnd style={{ top: '50%', transform: 'translateY(-50%)' }} />
    <Handle id="top" className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="source" position={Position.Top} isConnectableStart isConnectableEnd style={{ left: '50%', transform: 'translateX(-50%)' }} />
    {node.show_type_label && <span className="node-type-label">{icons[node.type]} {t(node.type === 'note' ? 'Заметка' : node.type === 'media' ? 'Медиакарточка' : node.type === 'track' ? 'Музыка' : 'Папка', node.type === 'note' ? 'Note' : node.type === 'media' ? 'Media card' : node.type === 'track' ? 'Music' : 'Folder')}</span>}
    {node.show_date && node.temporal_date && <time className={`node-date ${datePosition}`}>{formatNodeDate(node.temporal_date, language)}</time>}
    {node.type === 'media' && <MediaPreview assets={node.media_assets} onOpen={node.onOpenMedia} />}
    {node.type === 'track' && (coverUrl ? <img className="track-cover" src={coverUrl} alt="" /> : <div className="track-cover track-cover-placeholder" aria-hidden="true">♪</div>)}
    {node.type === 'media' && !hideTitle && <h3 className={`media-title ${titlePosition}`}>{node.title}</h3>}
    {!isPlaylist && node.type === 'note' && !hideTitle && <h3>{node.title}</h3>}
    {node.type === 'note' && node.text_content && <p>{node.text_content}</p>}
    {node.type === 'track' && !isPlaylist && !hideTrackDetails && <div className="track-info">{!hideTitle && <h3>{node.track_data?.title || t('Без названия', 'Untitled')}</h3>}<p>{node.track_data?.artist || t('Исполнитель не указан', 'Artist not specified')}</p>{node.track_data?.show_timeline && <div className="track-timeline" aria-label={`${t('Длительность', 'Duration')} ${formatTrackDuration(node.track_data.duration_seconds)}`}><span className="track-timeline-bar" /><time>{formatTrackDuration(node.track_data.duration_seconds)}</time></div>}</div>}
    {isPlaylist && <div className="playlist-summary">
      {!hideTitle && <h3>{node.track_data?.title}</h3>}
      <p>{playlistItems.length} {t('треков', 'tracks')}</p>
      <button className="playlist-toggle nodrag" onClick={event => { event.stopPropagation(); node.onPlaylistToggle?.() }}>{playlistOpen ? t('Скрыть треки', 'Hide tracks') : t('Показать треки', 'Show tracks')}</button>
    </div>}
    {isPlaylist && <PlaylistRows items={playlistOpen ? playlistItems : playlistPreview} preview={!playlistOpen} />}
    <Handle id="bottom" className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="source" position={Position.Bottom} isConnectableStart isConnectableEnd style={{ left: '50%', transform: 'translateX(-50%)' }} />
    <Handle id="right" className={`memory-handle ${showHandles ? 'is-visible' : ''}`} type="source" position={Position.Right} isConnectableStart isConnectableEnd style={{ top: '50%', transform: 'translateY(-50%)' }} />
  </div>
}

function FolderNode({ node, selected }: { node: FlowData; selected: boolean }) {
  const { t } = useLocalization()
  const isOpen = node.object_data?.folder_open === true
  const members = Array.isArray(node.object_data?.folder_member_ids) ? node.object_data.folder_member_ids : []
  const folderIconUrl = folderIconModules[node.object_data?.folder_icon_id || ''] || defaultFolderIconUrl
  return <div className={`folder-node ${selected ? 'selected' : ''} ${isOpen ? 'open' : ''}`}>
    <div className="folder-image-hitbox" onClick={() => node.onFolderToggle?.()} title={isOpen ? t('Скрыть содержимое папки', 'Hide folder contents') : t('Открыть папку', 'Open folder')}>
      {folderIconUrl ? <img src={folderIconUrl} alt="" draggable={false} /> : <span className="folder-node-fallback">▰</span>}
      {node.isFolderDropTarget && <span className="folder-drop-hint">{t('Перетащите объект', 'Drop object here')}</span>}
      {!isOpen && <span className="folder-node-count">{members.length}</span>}
    </div>
    <span className="folder-node-title">{node.title || t('Папка', 'Folder')}</span>
  </div>
}

function CanvasObject({ node, selected, resizeLimit }: { node: FlowData; selected: boolean; resizeLimit: { minWidth: number; minHeight: number } }) {
  const { t } = useLocalization()
  const data = node.previewObjectData || node.object_data || {}
  const hasText = node.type === 'canvas_text' && Boolean(data.text?.trim())
  return <div className={`canvas-object ${node.type} ${hasText ? 'has-text' : ''} ${selected ? 'selected' : ''}`}>
    <div className="object-drag-handle" title={t('Перетащить объект', 'Drag object')} />
    {node.type === 'canvas_text' && <CanvasText data={data} theme={node.theme || 'dark'} onChange={node.onObjectChange} />}
    {node.type === 'canvas_image' && <CanvasImage assets={node.media_assets} data={data} />}
    <NodeResizer isVisible={selected} {...resizeLimit} maxWidth={2400} maxHeight={1800} lineClassName="resize-line" handleClassName="resize-handle" onResizeEnd={(_, params) => node.onObjectChange?.({ width: params.width, height: params.height, position_x: params.x, position_y: params.y })} />
  </div>
}

const themeTextColors = new Set(['#fff', '#ffffff', 'white', '#000', '#000000', 'black'])
const resolveTextColor = (color: string | undefined, theme: 'dark' | 'light') => !color || themeTextColors.has(color.trim().toLowerCase()) ? theme === 'dark' ? '#ffffff' : '#000000' : color

function CanvasText({ data, theme, onChange }: { data: CanvasObjectData; theme: 'dark' | 'light'; onChange?: (patch: Partial<MemoryNode>) => void }) {
  const textRef = useRef<HTMLTextAreaElement>(null)
  const dataRef = useRef(data)
  const onChangeRef = useRef(onChange)
  const pendingTextRef = useRef<string | null>(null)

  useEffect(() => { dataRef.current = data }, [data])
  useEffect(() => { onChangeRef.current = onChange }, [onChange])
  useEffect(() => {
    const element = textRef.current
    // During an editing session the browser owns the text. Writing it back
    // from React can restore an older value and disrupt the caret.
    if (!element || document.activeElement === element) return
    const text = data.text || ''
    if (element.value !== text) element.value = text
  }, [data.text])

  const flush = () => {
    const text = pendingTextRef.current
    if (text === null) return
    pendingTextRef.current = null
    onChangeRef.current?.({ object_data: { ...dataRef.current, text } })
  }

  const update = (text: string) => {
    dataRef.current = { ...dataRef.current, text }
    pendingTextRef.current = text
  }
  return <div className="canvas-text-wrap" style={{ transform: `rotate(${data.rotation || 0}deg)` }}>
    <textarea ref={textRef} className="canvas-text nodrag" defaultValue={data.text || ''} wrap="soft" spellCheck={false} style={{ fontSize: data.font_size || 42, fontFamily: data.font_family || "Inter, 'Segoe UI', Arial, sans-serif", fontWeight: data.font_weight ? 800 : 500, fontStyle: data.font_style ? 'italic' : 'normal', textAlign: data.text_align || 'left', color: resolveTextColor(data.color, theme) }} onChange={event => update(event.currentTarget.value)} onBlur={flush} />
  </div>
}

function CanvasImage({ assets, data }: { assets: Asset[]; data: CanvasObjectData }) {
  const lastLoadedAsset = useRef<Asset | null>(null)
  if (assets[0]) lastLoadedAsset.current = assets[0]
  // Metadata updates can briefly arrive before the already-uploaded asset.
  // A canvas image owns exactly one PNG, so retain the last known asset here.
  const asset = assets[0] || lastLoadedAsset.current
  const scaleX = data.flip_x ? -1 : 1
  const scaleY = data.flip_y ? -1 : 1
  return asset ? <img className="canvas-image" style={{ transform: `rotate(${data.rotation || 0}deg) scale(${scaleX}, ${scaleY})` }} src={mediaUrl(asset.storage_path)} alt={asset.original_filename} draggable={false} /> : <span className="canvas-image-empty">PNG</span>
}

function MediaPreview({ assets, onOpen }: { assets: Asset[]; onOpen?: (assets: Asset[], index: number) => void }) {
  const { t } = useLocalization()
  const favorites = assets.filter(asset => asset.is_favorite)
  const previewAssets = (favorites.length ? favorites : assets).slice(0, 4)
  return <div className={`media-gallery assets-${Math.min(previewAssets.length, 4)}`}>{previewAssets.map(asset => <MediaTile key={asset.id} asset={asset} index={assets.findIndex(item => item.id === asset.id)} assets={assets} onOpen={onOpen} />)}{previewAssets.length === 0 && <span className="empty-media">{t('Добавьте фото или видео', 'Add photos or videos')}</span>}</div>
}
