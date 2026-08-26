import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react'
import { api, Asset, CanvasObjectData, DatePosition, MemoryNode, NodeType, PlaylistItem, SpotifyTrack, Track, mediaUrl } from './api'

type Props = {
  node: MemoryNode | null; boardStartDate: string; boardEndDate: string; onClose: () => void
  theme: 'dark' | 'light'
  onSave: (data: Partial<MemoryNode>, files?: File[]) => Promise<void>; onRequestDelete: () => void
  onDeleteAsset: (asset: Asset) => Promise<void>; onUpdateAsset: (asset: Asset, patch: Partial<Pick<Asset, 'is_favorite' | 'sort_order'>>) => Promise<void>
  onReorderAssets: (assets: Asset[]) => Promise<void>; onPreview: (data: Partial<MemoryNode>) => void; onTextChange: (data: CanvasObjectData) => void; onTextPreview: (fontFamily: string | null) => void; onCreate: (type: NodeType) => void
}

const emptyTrack: Track = { title: '', artist: '', kind: 'track', cover_size: 'small', playlist_items: [], collapsed_item_limit: 3, show_timeline: false, duration_seconds: 0, hide_details: false }
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
const parseDuration = (value: string) => {
  const match = value.trim().match(/^(\d+):([0-5]\d)$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}
const fontOptions = [
  { value: "Inter, 'Segoe UI', Arial, sans-serif", label: 'Интер / системный' }, { value: "'Segoe UI', Arial, sans-serif", label: 'Segoe UI' },
  { value: 'Arial, Helvetica, sans-serif', label: 'Arial' }, { value: 'Verdana, Geneva, sans-serif', label: 'Verdana' },
  { value: "Georgia, 'Times New Roman', serif", label: 'Georgia' }, { value: "'Times New Roman', Times, serif", label: 'Times New Roman' },
  { value: "'Courier New', Courier, monospace", label: 'Courier New' }, { value: "'Neucha', cursive", label: 'Neucha' },
  { value: "'Yeseva One', serif", label: 'Yeseva One' }, { value: "'Comfortaa', sans-serif", label: 'Comfortaa' },
  { value: "'Unbounded', sans-serif", label: 'Unbounded' }, { value: "'Rubik Mono One', monospace", label: 'Rubik Mono One' },
]
const folderIconModules = import.meta.glob('./assets/board-folders/**/*.{webp,png,jpg,jpeg,svg}', { eager: true, query: '?url', import: 'default' }) as Record<string, string>
const folderIconOptions = Object.entries(folderIconModules).map(([id, url]) => {
  const relativePath = id.replace('./assets/board-folders/', '')
  const parts = relativePath.split('/')
  const filename = parts.pop() || ''
  return { id, url, directory: parts.join('/'), label: filename.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ') || 'Папка' }
}).sort((left, right) => left.id.localeCompare(right.id, 'ru'))
const defaultFolderIconId = folderIconOptions.find(icon => icon.label === 'macos blue')?.id || folderIconOptions[0]?.id || ''

export default function Editor({ node, boardStartDate, boardEndDate, theme, onClose, onSave, onRequestDelete, onDeleteAsset, onUpdateAsset, onReorderAssets, onPreview, onTextChange, onTextPreview }: Props) {
  const [draft, setDraft] = useState<Partial<MemoryNode>>({})
  const [files, setFiles] = useState<File[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [draggedAssetId, setDraggedAssetId] = useState<number | null>(null)
  const [dropTargetId, setDropTargetId] = useState<number | null>(null)
  const [draggedPlaylistIndex, setDraggedPlaylistIndex] = useState<number | null>(null)
  const [playlistDropIndex, setPlaylistDropIndex] = useState<number | null>(null)
  const [spotifyQuery, setSpotifyQuery] = useState('')
  const [spotifyResults, setSpotifyResults] = useState<SpotifyTrack[]>([])
  const [spotifyError, setSpotifyError] = useState('')
  const [spotifySearching, setSpotifySearching] = useState(false)
  const [durationText, setDurationText] = useState('0:00')
  const [fontSizeInput, setFontSizeInput] = useState('42')
  const [fontMenuOpen, setFontMenuOpen] = useState(false)
  const [folderIconPickerOpen, setFolderIconPickerOpen] = useState(false)
  const [folderIconDirectory, setFolderIconDirectory] = useState('')
  const [editorTextValue, setEditorTextValue] = useState('')
  const [rotationInput, setRotationInput] = useState('0')
  const trackSaveQueue = useRef(Promise.resolve())
  const editorObjectDataRef = useRef<CanvasObjectData | null>(null)

  useEffect(() => {
    editorObjectDataRef.current = null
    setDraft(node ? { ...node, track_data: node.track_data ? { ...emptyTrack, ...node.track_data, playlist_items: node.track_data.playlist_items.map(item => ({ ...item, is_favorite: item.is_favorite ?? false })) } : undefined } : {})
    setDurationText(formatDuration(node?.track_data?.duration_seconds ?? 0))
    setFontSizeInput(String(node?.object_data?.font_size ?? 42))
    setEditorTextValue(node?.object_data?.text || '')
    setRotationInput(String(Math.round(node?.object_data?.rotation ?? 0)))
    setFontMenuOpen(false)
    setFolderIconPickerOpen(false)
    setFolderIconDirectory('')
    setFiles([]); setError(''); setSpotifyQuery(''); setSpotifyResults([]); setSpotifyError('')
  }, [node?.id])
  useEffect(() => {
    if (node?.type !== 'canvas_text') return
    if (editorObjectDataRef.current && JSON.stringify(editorObjectDataRef.current) === JSON.stringify(node.object_data || {})) {
      editorObjectDataRef.current = null
      return
    }
    setDraft(current => ({ ...current, object_data: node.object_data ? { ...node.object_data } : {} }))
    setEditorTextValue(node.object_data?.text || '')
    setFontSizeInput(String(node.object_data?.font_size ?? 42))
  }, [node?.id, node?.object_data])
  useEffect(() => {
    if (!node || node.type !== 'track' || spotifyQuery.trim().length < 2) { setSpotifyResults([]); setSpotifySearching(false); return }
    let cancelled = false
    const timer = window.setTimeout(async () => {
      setSpotifySearching(true); setSpotifyError('')
      try { const results = await api.spotifySearch(spotifyQuery.trim()); if (!cancelled) setSpotifyResults(results) }
      catch (searchError) { if (!cancelled) { setSpotifyResults([]); setSpotifyError(searchError instanceof Error ? searchError.message : 'Не удалось выполнить поиск') } }
      finally { if (!cancelled) setSpotifySearching(false) }
    }, 300)
    return () => { cancelled = true; window.clearTimeout(timer) }
  }, [node?.id, node?.type, spotifyQuery])

  const queueTrackSave = (next: Partial<MemoryNode>) => {
    const pending = trackSaveQueue.current.catch(() => undefined).then(() => onSave(next))
    trackSaveQueue.current = pending
    void pending.catch(saveError => setError(saveError instanceof Error ? saveError.message : 'Не удалось сохранить плейлист'))
  }
  const updateDraft = (updater: Partial<MemoryNode> | ((current: Partial<MemoryNode>) => Partial<MemoryNode>), persistTrack = false) => setDraft(current => { const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }; onPreview(next); if (persistTrack) queueTrackSave(next); return next })
  const updateTrack = (key: keyof Track, value: Track[keyof Track]) => updateDraft(current => ({ ...current, track_data: { ...emptyTrack, ...(current.track_data || {}), [key]: value } }), true)
  const updatePlaylistItem = (index: number, key: keyof PlaylistItem, value: PlaylistItem[keyof PlaylistItem]) => updateDraft(current => { const track = { ...emptyTrack, kind: 'playlist' as const, ...(current.track_data || {}) }; return { ...current, track_data: { ...track, playlist_items: track.playlist_items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) } } }, true)
  const reorderPlaylistItems = (from: number, to: number) => updateDraft(current => { const track = { ...emptyTrack, kind: 'playlist' as const, ...(current.track_data || {}) }; const items = [...track.playlist_items]; const [item] = items.splice(from, 1); items.splice(to, 0, item); return { ...current, track_data: { ...track, playlist_items: items } } }, true)
  const selectSpotifyTrack = (result: SpotifyTrack) => {
    updateDraft(current => {
      const track = { ...emptyTrack, ...(current.track_data || {}) }
      if (track.kind === 'playlist') return { ...current, track_data: { ...track, playlist_items: [...track.playlist_items, { title: result.title, artist: result.artist, cover_url: result.cover_url || null, is_favorite: false }] } }
      return { ...current, track_data: { ...track, title: result.title, artist: result.artist, spotify_id: result.id, spotify_cover_url: result.cover_url || null, duration_seconds: result.duration_seconds } }
    }, true)
    setDurationText(formatDuration(result.duration_seconds))
    setSpotifyQuery(''); setSpotifyResults([]); setSpotifyError('')
  }
  const save = async (closeAfter = false) => { if (busy) return; setBusy(true); setError(''); try { await trackSaveQueue.current; const savedDraft = node?.type === 'canvas_text' ? { ...draft, object_data: { ...(draft.object_data || {}), text: editorTextValue } } : draft; await onSave(savedDraft, files); setFiles([]); if (closeAfter) onClose() } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Ошибка сохранения') } finally { setBusy(false) } }
  const saveFolder = async (closeAfter = false) => {
    if (busy) return
    setBusy(true); setError('')
    try {
      const folderDraft: Partial<MemoryNode> = { title: draft.title }
      if (draft.object_data?.folder_icon_id) folderDraft.object_data = { folder_icon_id: draft.object_data.folder_icon_id }
      await onSave(folderDraft)
      if (closeAfter) onClose()
    }
    catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Ошибка сохранения') }
    finally { setBusy(false) }
  }
  const selectFolderIcon = (folderIconId: string) => {
    setDraft(current => ({ ...current, object_data: { ...(current.object_data || {}), folder_icon_id: folderIconId } }))
    setFolderIconPickerOpen(false)
    setFolderIconDirectory('')
    void onSave({ object_data: { folder_icon_id: folderIconId } }).catch(saveError => setError(saveError instanceof Error ? saveError.message : 'Ошибка сохранения'))
  }
  const reorderFromDrag = async (targetId: number) => { if (!node || draggedAssetId === null || draggedAssetId === targetId) return; const items = [...node.media_assets]; const from = items.findIndex(asset => asset.id === draggedAssetId); const to = items.findIndex(asset => asset.id === targetId); if (from < 0 || to < 0) return; const [item] = items.splice(from, 1); items.splice(to, 0, item); setDraggedAssetId(null); setDropTargetId(null); await onReorderAssets(items) }
  const folderIconEntries = useMemo(() => {
    const prefix = folderIconDirectory ? `${folderIconDirectory}/` : ''
    const directories = [...new Set(folderIconOptions
      .filter(icon => icon.directory.startsWith(prefix) && icon.directory !== folderIconDirectory)
      .map(icon => icon.directory.slice(prefix.length).split('/')[0])
      .filter(Boolean))].sort((left, right) => left.localeCompare(right, 'ru')).map(name => {
      const fullPath = `${prefix}${name}`
      return { name, cover: folderIconOptions.find(icon => icon.directory === fullPath || icon.directory.startsWith(`${fullPath}/`)) }
    })
    return { directories, icons: folderIconOptions.filter(icon => icon.directory === folderIconDirectory) }
  }, [folderIconDirectory])
  if (!node) return null
  if (node.type === 'canvas_text') {
    const text = draft.object_data || {}
    const defaultTextColor = theme === 'dark' ? '#ffffff' : '#000000'
    const normalizedTextColor = text.color?.trim().toLowerCase()
    const colorInputValue = !normalizedTextColor || ['#fff', '#ffffff', 'white', '#000', '#000000', 'black'].includes(normalizedTextColor) ? defaultTextColor : text.color
    const updateText = (patch: Partial<CanvasObjectData>) => {
      const next = { ...(draft.object_data || {}), text: editorTextValue, ...patch }
      if ('text' in patch) {
        setEditorTextValue(next.text || '')
        return
      }
      editorObjectDataRef.current = next
      setDraft(current => ({ ...current, object_data: next }))
      onPreview({ object_data: next })
      onTextChange(next)
    }
    const flushText = () => {
      if (text.text === editorTextValue) return
      const next = { ...text, text: editorTextValue }
      editorObjectDataRef.current = next
      setDraft(current => ({ ...current, object_data: next }))
      onPreview({ object_data: next })
      onTextChange(next)
    }
    return <aside className="editor" data-editor-title="Текст" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <button className="close" onClick={() => void save(true)} aria-label="Закрыть">×</button>
      <label>Текст<textarea value={editorTextValue} spellCheck={false} onChange={event => updateText({ text: event.target.value })} onBlur={flushText} rows={5} /></label>
      <label>Размер<input type="number" min="12" max="240" value={fontSizeInput} onChange={event => setFontSizeInput(event.target.value)} onBlur={() => { const size = Number(fontSizeInput); if (Number.isFinite(size) && size >= 12 && size <= 240) updateText({ font_size: size }); else setFontSizeInput(String(text.font_size || 42)) }} /></label>
      <label>Шрифт<div className="font-picker" onMouseLeave={() => onTextPreview(null)}><button type="button" className="font-picker-trigger" onClick={() => { onTextPreview(null); setFontMenuOpen(open => !open) }}>{fontOptions.find(option => option.value === (text.font_family || "Inter, 'Segoe UI', Arial, sans-serif"))?.label || 'Выбрать шрифт'}</button>{fontMenuOpen && <div className="font-picker-menu" role="listbox">{fontOptions.map(option => <button key={option.value} type="button" className={option.value === (text.font_family || "Inter, 'Segoe UI', Arial, sans-serif") ? 'active' : ''} style={{ fontFamily: option.value }} onMouseEnter={() => onTextPreview(option.value)} onFocus={() => onTextPreview(option.value)} onClick={() => { updateText({ font_family: option.value }); onTextPreview(null); setFontMenuOpen(false) }}>{option.label}</button>)}</div>}</div></label>
      <label className="toggle-label"><input type="checkbox" checked={text.font_weight || false} onChange={event => updateText({ font_weight: event.target.checked })} />Жирный</label>
      <label className="toggle-label"><input type="checkbox" checked={text.font_style || false} onChange={event => updateText({ font_style: event.target.checked })} />Курсив</label>
      <label>Выравнивание<select value={text.text_align || 'left'} onChange={event => updateText({ text_align: event.target.value as CanvasObjectData['text_align'] })}><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option><option value="justify">По ширине</option></select></label>
      <label>Поворот<input type="range" min="-180" max="180" step="1" value={text.rotation || 0} onChange={event => updateText({ rotation: Number(event.target.value) })} /><span className="range-value">{text.rotation || 0}°</span></label>
      <label>Цвет<input type="color" value={colorInputValue} onChange={event => updateText({ color: event.target.value })} /></label>
      {error && <p className="error">{error}</p>}<div className="editor-actions"><button className="danger" onClick={onRequestDelete}>Удалить</button>{busy && <span className="saving">Сохраняю…</span>}</div>
    </aside>
  }
  if (node.type === 'canvas_image') {
    const image = draft.object_data || {}
    const rotation = Math.max(-180, Math.min(180, Math.round(image.rotation ?? 0)))
    const updateImage = (patch: Partial<CanvasObjectData>) => {
      const next = { ...image, ...patch }
      updateDraft({ object_data: next })
      onTextChange(next)
    }
    const setRotation = (value: number) => {
      const nextRotation = Math.max(-180, Math.min(180, Math.round(value)))
      setRotationInput(String(nextRotation))
      updateImage({ rotation: nextRotation })
    }
    const commitRotation = () => {
      const value = Number(rotationInput)
      if (Number.isInteger(value)) setRotation(value)
      else setRotationInput(String(rotation))
    }
    return <aside className="editor" data-editor-title="Изображение" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <button className="close" onClick={() => void save(true)} aria-label="Закрыть">×</button>
      <label>Поворот<input type="range" min="-180" max="180" step="1" value={rotation} onChange={event => setRotation(Number(event.target.value))} /></label>
      <label>Угол<input type="text" inputMode="numeric" value={rotationInput} onChange={event => { const value = event.target.value; if (/^-?\d*$/.test(value)) setRotationInput(value) }} onBlur={commitRotation} onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commitRotation(); event.currentTarget.blur() } }} /></label>
      <div className="image-transform-actions"><button type="button" onClick={() => updateImage({ flip_x: !image.flip_x })}>Отразить по горизонтали</button><button type="button" onClick={() => updateImage({ flip_y: !image.flip_y })}>Отразить по вертикали</button></div>
      {error && <p className="error">{error}</p>}<div className="editor-actions"><button className="danger" onClick={onRequestDelete}>Удалить</button>{busy && <span className="saving">Сохраняю…</span>}</div>
    </aside>
  }
  if (node.type === 'folder') {
    const selectedFolderIcon = folderIconOptions.find(icon => icon.id === (draft.object_data?.folder_icon_id || defaultFolderIconId))
    return <aside className="editor" data-editor-title="Папка" onBlur={() => void saveFolder()} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <button className="close" onMouseDown={event => event.preventDefault()} onClick={() => void saveFolder(true)} aria-label="Закрыть">×</button>
    <label>Название<input value={draft.title || ''} onChange={event => updateDraft({ title: event.target.value })} placeholder="Папка" autoFocus /></label>
    <label>Иконка папки</label><button type="button" className="folder-icon-picker-button" onMouseDown={event => event.preventDefault()} onClick={() => setFolderIconPickerOpen(open => { if (!open) setFolderIconDirectory(''); return !open })}>{selectedFolderIcon && <img src={selectedFolderIcon.url} alt="" />}<span>{selectedFolderIcon?.label || 'Выбрать иконку'}</span></button>{folderIconPickerOpen && <div className="folder-icon-browser editor-folder-icon-browser">{folderIconDirectory && <button type="button" className="folder-icon-back" onMouseDown={event => event.preventDefault()} onClick={() => setFolderIconDirectory(current => current.split('/').slice(0, -1).join('/'))}>← Назад</button>}<div className="folder-icon-options editor-folder-icon-options">{folderIconEntries.directories.map(directory => <button type="button" key={directory.name} className="folder-icon-directory" onMouseDown={event => event.preventDefault()} onClick={() => setFolderIconDirectory(current => current ? `${current}/${directory.name}` : directory.name)} title={`Открыть папку «${directory.name}»`}>{directory.cover && <img src={directory.cover.url} alt="" />}<span>{directory.name}</span></button>)}{folderIconEntries.icons.map(icon => <button type="button" key={icon.id} className={(draft.object_data?.folder_icon_id || defaultFolderIconId) === icon.id ? 'selected' : ''} onMouseDown={event => event.preventDefault()} onClick={() => selectFolderIcon(icon.id)} title={icon.label}><img src={icon.url} alt="" /><span>{icon.label}</span></button>)}</div></div>}
    {error && <p className="error">{error}</p>}<div className="editor-actions"><button className="danger" onClick={onRequestDelete}>Удалить</button>{busy && <span className="saving">Сохраняю…</span>}</div>
  </aside>
  }
  const track = { ...emptyTrack, ...(draft.track_data || {}) }
  const spotifySearch = <div className="spotify-search"><label>Найти в Spotify<input value={spotifyQuery} onChange={event => setSpotifyQuery(event.target.value)} placeholder="Название трека или исполнитель" autoComplete="off" /></label>{spotifySearching && <p className="spotify-search-state">Ищу в Spotify…</p>}{spotifyError && <p className="error">{spotifyError}</p>}{spotifyResults.length > 0 && <div className="spotify-results">{spotifyResults.map(result => <button type="button" key={result.id} onClick={() => selectSpotifyTrack(result)}>{result.cover_url ? <img src={result.cover_url} alt="" /> : <span className="spotify-result-cover" />}<span><strong>{result.title}</strong><small>{result.artist}</small></span></button>)}</div>}</div>

  return <aside className="editor" data-editor-title={node.type === 'track' ? 'Музыка' : node.type === 'media' ? 'Медиакарточка' : 'Заметка'} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) void save() }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <button className="close" onClick={() => void save(true)} aria-label="Закрыть">×</button>
    {node.type !== 'track' && <label>Название<input value={draft.title || ''} onChange={event => updateDraft({ title: event.target.value })} placeholder={node.type === 'note' ? 'Можно оставить пустым' : 'Короткое название'} /></label>}
    {node.type === 'note' && <label>Текст<textarea value={draft.text_content || ''} spellCheck={false} onChange={event => updateDraft({ text_content: event.target.value })} placeholder="Что хочется сохранить?" rows={7} /></label>}
    {node.type === 'media' && <><label>Добавить файлы<input type="file" multiple accept="image/jpeg,image/png,image/webp,image/gif,video/mp4,video/webm,video/quicktime,video/x-m4v,.m4v" onChange={(event: ChangeEvent<HTMLInputElement>) => setFiles(Array.from(event.target.files || []))} /></label>{files.length > 0 && <p className="queued-files">Будет загружено: {files.map(file => file.name).join(', ')}</p>}<div className="asset-list">{node.media_assets.map(asset => <div className={`asset-row ${draggedAssetId === asset.id ? 'dragging' : ''} ${dropTargetId === asset.id && draggedAssetId !== asset.id ? 'drop-target' : ''}`} key={asset.id} draggable onDragStart={() => setDraggedAssetId(asset.id)} onDragEnd={() => { setDraggedAssetId(null); setDropTargetId(null) }} onDragOver={event => { event.preventDefault(); setDropTargetId(asset.id) }} onDragLeave={() => setDropTargetId(current => current === asset.id ? null : current)} onDrop={() => void reorderFromDrag(asset.id)}><span className="drag-handle" title="Перетащите для изменения порядка">⠿</span><button className={`favorite-asset ${asset.is_favorite ? 'active' : ''}`} title="Показывать в превью" onClick={() => onUpdateAsset(asset, { is_favorite: !asset.is_favorite })}>★</button><a href={mediaUrl(asset.storage_path)} target="_blank">{asset.original_filename}</a><button className="remove-asset" title="Удалить файл" onClick={() => onDeleteAsset(asset)}>×</button></div>)}</div></>}
    {node.type === 'track' && <>
      <label>Тип музыки<select value={track.kind} onChange={event => updateTrack('kind', event.target.value as Track['kind'])}><option value="track">Трек</option><option value="playlist">Плейлист</option></select></label>
      {track.kind === 'track' ? <>
        <label>Название трека<input value={track.title} onChange={event => updateTrack('title', event.target.value)} /></label>
        <label>Исполнитель<input value={track.artist} onChange={event => updateTrack('artist', event.target.value)} /></label>
        {spotifySearch}
        {track.title && <p className="spotify-selected">Выбрано: <strong>{track.title}</strong>{track.artist && ` — ${track.artist}`}</p>}
        <label className="toggle-label"><input type="checkbox" checked={track.hide_details} onChange={event => updateTrack('hide_details', event.target.checked)} />Скрыть название и исполнителя</label>
        <label className="toggle-label"><input type="checkbox" checked={track.show_timeline} onChange={event => updateTrack('show_timeline', event.target.checked)} />Показывать шкалу трека</label>
        {track.show_timeline && <label>Длительность (м:с)<input value={durationText} inputMode="numeric" placeholder="2:34" onChange={event => { const value = event.target.value; setDurationText(value); const seconds = parseDuration(value); if (seconds !== null) updateTrack('duration_seconds', seconds) }} onBlur={() => { const seconds = parseDuration(durationText); setDurationText(formatDuration(seconds ?? track.duration_seconds)); if (seconds !== null) updateTrack('duration_seconds', seconds) }} /></label>}
      </> : <>
        <label>Название плейлиста<input value={track.title} onChange={event => updateTrack('title', event.target.value)} placeholder="Можно оставить пустым" /></label>
        {spotifySearch}
        <label>Треков в свёрнутом виде<input type="number" min="0" max="10" value={track.collapsed_item_limit} onChange={event => updateTrack('collapsed_item_limit', Math.max(0, Math.min(10, Number(event.target.value) || 0)))} /></label>
        <div className="playlist-editor"><p>Треки в плейлисте</p>{track.playlist_items.map((item, index) => <div className={`playlist-row ${draggedPlaylistIndex === index ? 'dragging' : ''} ${playlistDropIndex === index && draggedPlaylistIndex !== index ? 'drop-target' : ''}`} key={`${item.title}-${item.artist}-${index}`} draggable onDragStart={() => setDraggedPlaylistIndex(index)} onDragEnd={() => { setDraggedPlaylistIndex(null); setPlaylistDropIndex(null) }} onDragOver={event => { event.preventDefault(); setPlaylistDropIndex(index) }} onDragLeave={() => setPlaylistDropIndex(current => current === index ? null : current)} onDrop={() => { if (draggedPlaylistIndex !== null && draggedPlaylistIndex !== index) reorderPlaylistItems(draggedPlaylistIndex, index); setDraggedPlaylistIndex(null); setPlaylistDropIndex(null) }}><span className="playlist-drag" title="Перетащите для изменения порядка">⠿</span><button type="button" className={`playlist-favorite ${item.is_favorite ? 'active' : ''}`} title="Показывать в свёрнутом виде" onClick={() => updatePlaylistItem(index, 'is_favorite', !item.is_favorite)}>★</button><input value={item.title} placeholder="Название" onChange={event => updatePlaylistItem(index, 'title', event.target.value)} /><input value={item.artist} placeholder="Исполнитель" onChange={event => updatePlaylistItem(index, 'artist', event.target.value)} /><button type="button" className="remove-playlist-item" onClick={() => updateDraft(current => ({ ...current, track_data: { ...track, playlist_items: track.playlist_items.filter((_, itemIndex) => itemIndex !== index) } }))}>×</button></div>)}<button type="button" className="add-track" onClick={() => updateDraft(current => ({ ...current, track_data: { ...track, playlist_items: [...track.playlist_items, { title: '', artist: '', cover_url: null, is_favorite: false }] } }))}>+ Добавить трек вручную</button></div>
      </>}
      <label>Иконка<select value={track.cover_size} onChange={event => updateTrack('cover_size', event.target.value as Track['cover_size'])}><option value="small">Маленькая</option><option value="large">Большая</option></select></label>
      {track.kind !== 'playlist' && !track.cover_url && track.spotify_cover_url && <p className="spotify-cover-hint">Обложка получена из Spotify</p>}
      <label>Обложка URL (вручную)<input value={track.cover_url || ''} onChange={event => updateTrack('cover_url', event.target.value)} /></label>
    </>}
    <label className="toggle-label"><input type="checkbox" checked={draft.show_type_label ?? false} onChange={event => updateDraft({ show_type_label: event.target.checked })} />Показывать тип ноды</label>{node.type === 'media' && <label>Расположение названия<select value={draft.title_position || 'bottom-center'} onChange={event => updateDraft({ title_position: event.target.value as DatePosition })}><option value="top-left">Слева сверху</option><option value="top-center">По центру сверху</option><option value="top-right">Справа сверху</option><option value="bottom-left">Слева снизу</option><option value="bottom-center">По центру снизу</option><option value="bottom-right">Справа снизу</option></select></label>}<label>Дата в периоде<input type="date" min={boardStartDate} max={boardEndDate} value={draft.temporal_date || ''} onChange={event => updateDraft({ temporal_date: event.target.value || null })} /></label><label className="toggle-label"><input type="checkbox" checked={draft.show_date ?? true} onChange={event => updateDraft({ show_date: event.target.checked })} />Показывать дату на ноде</label><label>Расположение даты<select value={draft.date_position || 'bottom-center'} onChange={event => updateDraft({ date_position: event.target.value as DatePosition })}><option value="top-left">Слева сверху</option><option value="top-center">По центру сверху</option><option value="top-right">Справа сверху</option><option value="bottom-left">Слева снизу</option><option value="bottom-center">По центру снизу</option><option value="bottom-right">Справа снизу</option></select></label>{error && <p className="error">{error}</p>}<div className="editor-actions"><button className="danger" onClick={onRequestDelete}>Удалить</button>{busy && <span className="saving">Сохраняю…</span>}</div>
  </aside>
}
