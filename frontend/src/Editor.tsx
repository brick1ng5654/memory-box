import { ChangeEvent, useEffect, useState } from 'react'
import { api, Asset, CanvasObjectData, DatePosition, MemoryNode, NodeType, PlaylistItem, SpotifyTrack, Track, mediaUrl } from './api'

type Props = {
  node: MemoryNode | null; boardStartDate: string; boardEndDate: string; onClose: () => void
  onSave: (data: Partial<MemoryNode>, files?: File[]) => Promise<void>; onRequestDelete: () => void
  onDeleteAsset: (asset: Asset) => Promise<void>; onUpdateAsset: (asset: Asset, patch: Partial<Pick<Asset, 'is_favorite' | 'sort_order'>>) => Promise<void>
  onReorderAssets: (assets: Asset[]) => Promise<void>; onPreview: (data: Partial<MemoryNode>) => void; onCreate: (type: NodeType) => void
}

const emptyTrack: Track = { title: '', artist: '', kind: 'track', cover_size: 'small', playlist_items: [], collapsed_item_limit: 3, show_timeline: false, duration_seconds: 0, hide_details: false }
const formatDuration = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
const parseDuration = (value: string) => {
  const match = value.trim().match(/^(\d+):([0-5]\d)$/)
  return match ? Number(match[1]) * 60 + Number(match[2]) : null
}

export default function Editor({ node, boardStartDate, boardEndDate, onClose, onSave, onRequestDelete, onDeleteAsset, onUpdateAsset, onReorderAssets, onPreview }: Props) {
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

  useEffect(() => {
    setDraft(node ? { ...node, track_data: node.track_data ? { ...emptyTrack, ...node.track_data, playlist_items: node.track_data.playlist_items.map(item => ({ ...item, is_favorite: item.is_favorite ?? false })) } : undefined } : {})
    setDurationText(formatDuration(node?.track_data?.duration_seconds ?? 0))
    setFontSizeInput(String(node?.object_data?.font_size ?? 42))
    setFiles([]); setError(''); setSpotifyQuery(''); setSpotifyResults([]); setSpotifyError('')
  }, [node?.id])
  useEffect(() => {
    if (node?.type !== 'canvas_text') return
    setDraft(current => ({ ...current, object_data: node.object_data ? { ...node.object_data } : {} }))
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

  const updateDraft = (updater: Partial<MemoryNode> | ((current: Partial<MemoryNode>) => Partial<MemoryNode>)) => setDraft(current => { const next = typeof updater === 'function' ? updater(current) : { ...current, ...updater }; onPreview(next); return next })
  const updateTrack = (key: keyof Track, value: Track[keyof Track]) => updateDraft(current => ({ ...current, track_data: { ...emptyTrack, ...(current.track_data || {}), [key]: value } }))
  const updatePlaylistItem = (index: number, key: keyof PlaylistItem, value: PlaylistItem[keyof PlaylistItem]) => updateDraft(current => { const track = { ...emptyTrack, kind: 'playlist' as const, ...(current.track_data || {}) }; return { ...current, track_data: { ...track, playlist_items: track.playlist_items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item) } } })
  const reorderPlaylistItems = (from: number, to: number) => updateDraft(current => { const track = { ...emptyTrack, kind: 'playlist' as const, ...(current.track_data || {}) }; const items = [...track.playlist_items]; const [item] = items.splice(from, 1); items.splice(to, 0, item); return { ...current, track_data: { ...track, playlist_items: items } } })
  const selectSpotifyTrack = (result: SpotifyTrack) => {
    updateDraft(current => {
      const track = { ...emptyTrack, ...(current.track_data || {}) }
      if (track.kind === 'playlist') return { ...current, track_data: { ...track, playlist_items: [...track.playlist_items, { title: result.title, artist: result.artist, cover_url: result.cover_url || null, is_favorite: false }] } }
      return { ...current, track_data: { ...track, title: result.title, artist: result.artist, spotify_id: result.id, spotify_cover_url: result.cover_url || null, duration_seconds: result.duration_seconds } }
    })
    setDurationText(formatDuration(result.duration_seconds))
    setSpotifyQuery(''); setSpotifyResults([]); setSpotifyError('')
  }
  const save = async (closeAfter = false) => { if (busy) return; setBusy(true); setError(''); try { await onSave(draft, files); setFiles([]); if (closeAfter) onClose() } catch (saveError) { setError(saveError instanceof Error ? saveError.message : 'Ошибка сохранения') } finally { setBusy(false) } }
  const reorderFromDrag = async (targetId: number) => { if (!node || draggedAssetId === null || draggedAssetId === targetId) return; const items = [...node.media_assets]; const from = items.findIndex(asset => asset.id === draggedAssetId); const to = items.findIndex(asset => asset.id === targetId); if (from < 0 || to < 0) return; const [item] = items.splice(from, 1); items.splice(to, 0, item); setDraggedAssetId(null); setDropTargetId(null); await onReorderAssets(items) }
  if (!node) return null
  if (node.type === 'canvas_text') {
    const text = draft.object_data || {}
    const textColors = ['#f7f2ff', '#f7b8c6', '#ffcb85', '#f4e57a', '#a7e6ba', '#8bd8ff', '#b7a4ff', '#f0a4f5', '#1c1a22']
    const updateText = (patch: Partial<CanvasObjectData>) => updateDraft(current => ({ ...current, object_data: { ...(current.object_data || {}), ...patch } }))
    return <aside className="editor" onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
      <button className="close" onClick={() => void save(true)}>×</button><p className="eyebrow">Текст на холсте</p><h2>Оформление текста</h2>
      <label>Текст<textarea value={text.text || ''} onChange={event => updateText({ text: event.target.value })} rows={5} /></label>
      <label>Размер<input type="number" min="12" max="240" value={fontSizeInput} onChange={event => setFontSizeInput(event.target.value)} onBlur={() => { const size = Number(fontSizeInput); if (Number.isFinite(size) && size >= 12 && size <= 240) updateText({ font_size: size }); else setFontSizeInput(String(text.font_size || 42)) }} /></label>
      <label>Шрифт<select value={text.font_family || "Inter, 'Segoe UI', Arial, sans-serif"} onChange={event => updateText({ font_family: event.target.value })}><option value="Inter, 'Segoe UI', Arial, sans-serif">Интер / системный</option><option value="'Segoe UI', Arial, sans-serif">Segoe UI</option><option value="Arial, Helvetica, sans-serif">Arial</option><option value="Verdana, Geneva, sans-serif">Verdana</option><option value="Georgia, 'Times New Roman', serif">Georgia</option><option value="'Times New Roman', Times, serif">Times New Roman</option><option value="'Courier New', Courier, monospace">Courier New</option><option value="'Neucha', cursive">Neucha</option><option value="'Yeseva One', serif">Yeseva One</option><option value="'Comfortaa', sans-serif">Comfortaa</option><option value="'Unbounded', sans-serif">Unbounded</option><option value="'Rubik Mono One', monospace">Rubik Mono One</option></select></label>
      <label className="toggle-label"><input type="checkbox" checked={text.font_weight || false} onChange={event => updateText({ font_weight: event.target.checked })} />Жирный</label>
      <label className="toggle-label"><input type="checkbox" checked={text.font_style || false} onChange={event => updateText({ font_style: event.target.checked })} />Курсив</label>
      <label>Выравнивание<select value={text.text_align || 'left'} onChange={event => updateText({ text_align: event.target.value as CanvasObjectData['text_align'] })}><option value="left">Слева</option><option value="center">По центру</option><option value="right">Справа</option><option value="justify">По ширине</option></select></label>
      <label>Цвет</label><div className="text-color-palette" aria-label="Палитра цветов">{textColors.map(color => <button key={color} type="button" className={text.color === color ? 'active' : ''} style={{ backgroundColor: color }} title={color} onClick={() => updateText({ color })} />)}</div><label>Свой цвет<input type="color" value={text.color || '#f7f2ff'} onChange={event => updateText({ color: event.target.value })} /></label>
      {error && <p className="error">{error}</p>}<div className="editor-actions"><button className="danger" onClick={onRequestDelete}>Удалить</button>{busy && <span className="saving">Сохраняю…</span>}</div>
    </aside>
  }
  const track = { ...emptyTrack, ...(draft.track_data || {}) }
  const spotifySearch = <div className="spotify-search"><label>Найти в Spotify<input value={spotifyQuery} onChange={event => setSpotifyQuery(event.target.value)} placeholder="Название трека или исполнитель" autoComplete="off" /></label>{spotifySearching && <p className="spotify-search-state">Ищу в Spotify…</p>}{spotifyError && <p className="error">{spotifyError}</p>}{spotifyResults.length > 0 && <div className="spotify-results">{spotifyResults.map(result => <button type="button" key={result.id} onClick={() => selectSpotifyTrack(result)}>{result.cover_url ? <img src={result.cover_url} alt="" /> : <span className="spotify-result-cover" />}<span><strong>{result.title}</strong><small>{result.artist}</small></span></button>)}</div>}</div>

  return <aside className="editor" onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node)) void save() }} onPointerDown={event => event.stopPropagation()} onKeyDown={event => event.stopPropagation()} onKeyUp={event => event.stopPropagation()}>
    <button className="close" onClick={() => void save(true)}>×</button><p className="eyebrow">{node.type === 'track' ? 'Музыка' : node.type === 'media' ? 'Медиакарточка' : 'Заметка'}</p><h2>Воспоминание</h2>
    {node.type !== 'track' && <label>Название<input value={draft.title || ''} onChange={event => updateDraft({ title: event.target.value })} placeholder={node.type === 'note' ? 'Можно оставить пустым' : 'Короткое название'} /></label>}
    {node.type === 'note' && <label>Текст<textarea value={draft.text_content || ''} onChange={event => updateDraft({ text_content: event.target.value })} placeholder="Что хочется сохранить?" rows={7} /></label>}
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
