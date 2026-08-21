export type NsfwUserRole = 'user' | 'admin'

export interface NsfwPublicUser {
  id: string
  username: string
  role: NsfwUserRole
  active: boolean
  avatarAssetId: string | null
  createdAt: number
  updatedAt: number
  lastLoginAt: number | null
}

export interface NsfwSessionUser {
  id: string
  username: string
  role: NsfwUserRole
}

export type NsfwAuthMode = 'bootstrap' | 'login' | 'session'

export interface NsfwAuthStatus {
  mode: NsfwAuthMode
  user: NsfwSessionUser | null
}

export interface NsfwBootstrapInput {
  username: string
  password: string
}

export interface NsfwLoginInput {
  username: string
  password: string
}

export interface NsfwCreateUserInput {
  username: string
  password: string
  role: NsfwUserRole
}

export interface NsfwUpdateUserInput {
  username?: string
  role?: NsfwUserRole
  password?: string
  active?: boolean
}
