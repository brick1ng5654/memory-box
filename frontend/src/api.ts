export type NodeType = 'note' | 'media' | 'track'
export type Asset = { id: number; original_filename: string; storage_path: string; preview_path?: string | null; mime_type: string; size_bytes: number; width?: number | null; height?: number | null; duration?: number | null; sort_order: number; is_favorite: boolean }
export type PlaylistItem = { title: string; artist: string; cover_url?: string | null; is_favorite: boolean }
export type Track = { title: string; artist: string; kind: 'track' | 'playlist'; cover_size: 'small' | 'large'; playlist_items: PlaylistItem[]; collapsed_item_limit: number; spotify_id?: string | null; cover_url?: string | null; spotify_cover_url?: string | null }
export type SpotifyTrack = { id: string; title: string; artist: string; cover_url?: string | null }
export type MemoryNode = { id: number; board_id: number; type: NodeType; title: string; text_content?: string | null; position_x: number; position_y: number; z_index: number; width?: number | null; height?: number | null; temporal_date?: string | null; media_assets: Asset[]; track_data?: Track | null }
export type MemoryEdge = { id: number; board_id: number; source_node_id: number; target_node_id: number; label?: string | null }
export type Board = { id: number; title: string; year: number; month: number; start_date: string; end_date: string; nodes: MemoryNode[]; edges: MemoryEdge[] }

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, { headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) }, ...init })
  if (!res.ok) { const data = await res.json().catch(() => null); throw new Error(data?.detail || 'Не удалось выполнить запрос') }
  return res.status === 204 ? undefined as T : res.json()
}

export const api = {
  board: (id: number) => request<Board>(`/boards/${id}`),
  boards: () => request<Board[]>('/boards'),
  createBoard: (data: Pick<Board, 'title' | 'start_date' | 'end_date'>) => request<Board>('/boards', { method: 'POST', body: JSON.stringify(data) }),
  updateBoard: (id: number, data: Partial<Pick<Board, 'title' | 'start_date' | 'end_date'>>) => request<Board>(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteBoard: (id: number) => request<void>(`/boards/${id}`, { method: 'DELETE' }),
  spotifySearch: (query: string) => request<SpotifyTrack[]>(`/spotify/search?query=${encodeURIComponent(query)}`),
  renameBoard: (id: number, title: string) => request<Board>(`/boards/${id}`, { method: 'PATCH', body: JSON.stringify({ title }) }),
  createNode: (boardId: number, data: Partial<MemoryNode> & { type: NodeType }) => request<MemoryNode>(`/boards/${boardId}/nodes`, { method: 'POST', body: JSON.stringify(data) }),
  node: (id: number) => request<MemoryNode>(`/nodes/${id}`),
  updateNode: (id: number, data: Partial<MemoryNode>) => request<MemoryNode>(`/nodes/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  deleteNode: (id: number) => request<void>(`/nodes/${id}`, { method: 'DELETE' }),
  createEdge: (boardId: number, source_node_id: number, target_node_id: number) => request<MemoryEdge>(`/boards/${boardId}/edges`, { method: 'POST', body: JSON.stringify({ source_node_id, target_node_id }) }),
  deleteEdge: (id: number) => request<void>(`/edges/${id}`, { method: 'DELETE' }),
  deleteMedia: (id: number) => request<void>(`/media/${id}`, { method: 'DELETE' }),
  updateMedia: (id: number, data: Partial<Pick<Asset, 'sort_order' | 'is_favorite'>>) => request<Asset>(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
  upload: async (nodeId: number, file: File) => { const fd = new FormData(); fd.append('file', file); const res = await fetch(`/api/nodes/${nodeId}/media`, { method: 'POST', body: fd }); if (!res.ok) { const d = await res.json().catch(() => null); throw new Error(d?.detail || 'Не удалось загрузить файл') }; return res.json() as Promise<Asset> }
}
export const mediaUrl = (path?: string | null) => path ? `/media/${path}` : undefined
