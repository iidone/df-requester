import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import brandIcon from './assets/icon.ico'
import './App.css'

type Role = 'manager' | 'operator' | 'admin'
type User = { id: number; username: string; full_name: string; role: Role }
type RequestRecord = {
  id: number
  timestamp: string
  requester: string
  item_type: string
  model: string
  is_custom: boolean
  size: string
  base_material: string
  body_material: string
  additional_material: string
  coating: string
  other_materials: string
  order_number: string
  note: string
  image_url: string | null
  creation_date: string | null
  nomenclature: string | null
  is_completed: boolean
}
type RequestFields = Omit<RequestRecord, 'id' | 'timestamp' | 'image_url' | 'creation_date' | 'nomenclature' | 'is_completed' | 'is_custom'> & {
  is_custom: string
  creation_date: string
  nomenclature: string
}
type Modal = 'create' | 'edit' | 'complete' | 'user' | 'confirm-delete' | null
type UserForm = { username: string; full_name: string; role: Role; password: string }
type PendingDeletion = { type: 'user'; target: User } | { type: 'request'; target: RequestRecord }

const API_URL = import.meta.env.VITE_API_URL ?? '/api'
const IMAGE_TRANSITION_MS = 240
const MODAL_TRANSITION_MS = 240
const ITEM_TYPES = ['Браслет', 'Вставка', 'Значок', 'Икона', 'Колье', 'Кольцо', 'Крест', 'Подвеска', 'Серьги', 'Сувенир', 'Цепи', 'Четки']
const COATINGS = ['Без покрытия', 'Чернение (Обычное чернение серебра)', 'Белый родий (Стандартный белый цвет, для тонких цепей и изделий женской коллекции)',
   'Черный родий (Темно-серый цвет, стандарт для золотых/платиновых изделий с чернением)',
    'Черный рутений (Цвет Черный/Антрацит, для золотых изделий категории супер вип, ПО СОГЛАСОВАНИЮ)',
     'Желтое золочение (Для специальных изделий)', 'Красное золочение (Для специальных изделий)',
      'Нанокерамика (Экспериментальная)', 'Платинирование (Белый цвет со сталистым оттенком, по запросу)',
       'Комбинированное покрытие (Несколько типов покрытий, указываются в комментарии']
const ROLE_LABELS: Record<Role, string> = { manager: 'Менеджер', operator: 'Оператор', admin: 'Администратор' }
const emptyFields: RequestFields = {
  requester: '',
  item_type: '',
  model: '',
  is_custom: 'false',
  size: '',
  base_material: '',
  body_material: '',
  additional_material: '',
  coating: '',
  other_materials: '',
  order_number: '',
  note: '',
  creation_date: '',
  nomenclature: '',
}

class ApiError extends Error {
  readonly status: number
  readonly requestId?: number
  readonly requestTimestamp?: string

  constructor(message: string, status: number, requestId?: number, requestTimestamp?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.requestId = requestId
    this.requestTimestamp = requestTimestamp
  }
}

async function api<T>(path: string, token: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers)
  if (token) headers.set('Authorization', `Bearer ${token}`)
  if (init.body && !(init.body instanceof FormData)) headers.set('Content-Type', 'application/json')
  const response = await fetch(`${API_URL}${path}`, { ...init, headers })
  if (!response.ok) {
    let message = 'Не удалось выполнить запрос'
    let requestId: number | undefined
    let requestTimestamp: string | undefined
    try {
      const body = await response.json() as { detail?: string | { message?: string; request_id?: number; request_timestamp?: string } }
      if (typeof body.detail === 'string') {
        message = body.detail
      } else if (body.detail) {
        message = body.detail.message ?? message
        requestId = body.detail.request_id
        requestTimestamp = body.detail.request_timestamp
      }
    } catch {
      message = `${message} (${response.status})`
    }
    throw new ApiError(message, response.status, requestId, requestTimestamp)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(value))
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value))
}

function displayValue(value: string | null | undefined) {
  return value?.trim() || '—'
}

function RequestField({ label, value, highlighted = false, scrollable = false }: { label: string; value: ReactNode; highlighted?: boolean; scrollable?: boolean }) {
  return (
    <div className={`request-field${highlighted ? ' request-field-highlighted' : ''}${scrollable ? ' request-field-scrollable' : ''}`}>
      <small>{label}</small>
      <span>{value}</span>
    </div>
  )
}

function makeFormData(fields: RequestFields, image: File | null, includeCompletion: boolean) {
  const body = new FormData()
  for (const [key, value] of Object.entries(fields)) {
    if (key === 'creation_date' && !includeCompletion) continue
    if (key === 'nomenclature' && !includeCompletion) continue
    if (key === 'creation_date' && !value) continue
    body.append(key, value)
  }
  body.set('is_custom', fields.is_custom)
  if (image) body.set('image', image)
  return body
}

function App() {
  const [token, setToken] = useState(() => localStorage.getItem('df-requester-token') ?? '')
  const [user, setUser] = useState<User | null>(null)
  const [requests, setRequests] = useState<RequestRecord[]>([])
  const [requestLimit, setRequestLimit] = useState(10)
  const [users, setUsers] = useState<User[]>([])
  const [activeTab, setActiveTab] = useState<'requests' | 'users'>('requests')
  const [search, setSearch] = useState('')
  const [userSearch, setUserSearch] = useState('')
  const [filter, setFilter] = useState<'all' | 'new' | 'done'>('all')
  const [modal, setModal] = useState<Modal>(null)
  const [closingModal, setClosingModal] = useState(false)
  const [pendingDeletion, setPendingDeletion] = useState<PendingDeletion | null>(null)
  const [selectedRequest, setSelectedRequest] = useState<RequestRecord | null>(null)
  const [fields, setFields] = useState<RequestFields>(emptyFields)
  const [image, setImage] = useState<File | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [closingPreview, setClosingPreview] = useState(false)
  const [removeImage, setRemoveImage] = useState(false)
  const [userForm, setUserForm] = useState<UserForm>({ username: '', full_name: '', role: 'manager', password: '' })
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicateRequestId, setDuplicateRequestId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    if (!previewImage) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setClosingPreview(true)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [previewImage])

  useEffect(() => {
    if (!closingPreview) return
    const timeout = window.setTimeout(() => {
      setPreviewImage(null)
      setClosingPreview(false)
    }, IMAGE_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [closingPreview])

  useEffect(() => {
    if (!closingModal) return
    const timeout = window.setTimeout(() => {
      setModal(null)
      setClosingModal(false)
      setPendingDeletion(null)
    }, MODAL_TRANSITION_MS)
    return () => window.clearTimeout(timeout)
  }, [closingModal])

  useEffect(() => {
    if (!token) return
    let active = true
    api<User>('/auth/me', token)
      .then((me) => { if (active) setUser(me) })
      .catch(() => {
        localStorage.removeItem('df-requester-token')
        if (active) {
          setToken('')
          setUser(null)
        }
      })
    return () => { active = false }
  }, [token])

  useEffect(() => {
    if (!user || !token) return
    let active = true
    const refresh = async () => {
      try {
        const [requestData, userData] = await Promise.all([
          api<RequestRecord[]>('/requests', token),
          user.role === 'admin' && activeTab === 'users' ? api<User[]>('/users', token) : Promise.resolve(null),
        ])
        if (!active) return
        setRequests(requestData)
        if (userData) setUsers(userData)
        setError('')
      } catch (reason) {
        if (active) setError(reason instanceof Error ? reason.message : 'Не удалось обновить данные')
      }
    }
    void refresh()
    const interval = window.setInterval(() => { void refresh() }, 10000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [activeTab, token, user])

  const filteredRequests = useMemo(() => {
    const query = search.trim().toLocaleLowerCase('ru')
    return requests.filter((request) => {
      const matchesStatus = filter === 'all' || (filter === 'new' ? !request.is_completed : request.is_completed)
      const matchesText = !query || [
        String(request.id),
        request.timestamp,
        formatTimestamp(request.timestamp),
        request.requester,
        request.item_type,
        request.model,
        request.is_custom ? 'да' : 'нет',
        request.size,
        request.base_material,
        request.body_material,
        request.additional_material,
        request.coating,
        request.other_materials,
        request.order_number,
        request.note,
        request.creation_date ?? '',
        request.creation_date ? formatDate(request.creation_date) : '',
        request.nomenclature,
        request.is_completed ? 'готово' : 'новая',
      ].some((value) => value?.toLocaleLowerCase('ru').includes(query))
      return matchesStatus && matchesText
    })
  }, [filter, requests, search])
  const visibleRequests = filteredRequests.slice(0, requestLimit)
  const filteredUsers = useMemo(() => {
    const query = userSearch.trim().toLocaleLowerCase('ru')
    return users.filter((item) => [item.username, item.full_name, ROLE_LABELS[item.role]]
      .some((value) => value.toLocaleLowerCase('ru').includes(query)))
  }, [users, userSearch])

  const newCount = requests.filter((request) => !request.is_completed).length
  const doneCount = requests.length - newCount

  function setField<K extends keyof RequestFields>(key: K, value: RequestFields[K]) {
    setFields((current) => ({ ...current, [key]: value }))
  }

  function openModal(nextModal: Exclude<Modal, null>) {
    setClosingModal(false)
    setModal(nextModal)
  }

  function closeModal() {
    if (modal && !closingModal) setClosingModal(true)
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    const form = new FormData(event.currentTarget)
    try {
      const result = await api<{ token: string; user: User }>('/auth/login', '', {
        method: 'POST',
        body: JSON.stringify({ username: form.get('username'), password: form.get('password') }),
      })
      localStorage.setItem('df-requester-token', result.token)
      setToken(result.token)
      setUser(result.user)
      setRequestLimit(10)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось войти')
    } finally {
      setBusy(false)
    }
  }

  async function initializeSystem() {
    setBusy(true)
    setError('')
    try {
      const result = await api<{ message: string }>('/init', '', { method: 'POST' })
      setNotice(result.message)
      setSetupOpen(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось инициализировать систему')
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    try {
      await api('/auth/logout', token, { method: 'POST' })
    } finally {
      localStorage.removeItem('df-requester-token')
      setToken('')
      setUser(null)
      setRequests([])
      setRequestLimit(10)
    }
  }

  function openRequestForm(mode: 'create' | 'edit', request?: RequestRecord) {
    setError('')
    setDuplicateRequestId(null)
    setImage(null)
    setRemoveImage(false)
    setSelectedRequest(request ?? null)
    setFields(request ? {
      requester: request.requester,
      item_type: request.item_type,
      model: request.model,
      is_custom: String(request.is_custom),
      size: request.size,
      base_material: request.base_material,
      body_material: request.body_material,
      additional_material: request.additional_material,
      coating: request.coating,
      other_materials: request.other_materials,
      order_number: request.order_number,
      note: request.note,
      creation_date: request.creation_date ?? '',
      nomenclature: request.nomenclature ?? '',
    } : { ...emptyFields, requester: user?.full_name || user?.username || '' })
    openModal(mode)
  }

  function openImagePreview(imageUrl: string) {
    setClosingPreview(false)
    setPreviewImage(imageUrl)
  }

  function closeImagePreview() {
    setClosingPreview(true)
  }

  async function saveRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setDuplicateRequestId(null)
    try {
      const body = makeFormData(fields, image, modal === 'edit' && user?.role === 'admin')
      if (modal === 'edit' && removeImage) body.set('remove_image', 'true')
      const path = modal === 'edit' ? `/requests/${selectedRequest?.id}` : '/requests'
      const result = await api<RequestRecord>(path, token, { method: modal === 'edit' ? 'PUT' : 'POST', body })
      setRequests((current) => modal === 'edit'
        ? current.map((request) => request.id === result.id ? result : request)
        : [result, ...current])
      closeModal()
      setNotice(modal === 'edit' ? 'Изменения сохранены' : 'Заявка отправлена оператору')
    } catch (reason) {
      const duplicateTime = reason instanceof ApiError && reason.requestTimestamp
        ? ` Время создания: ${formatTimestamp(reason.requestTimestamp)}.`
        : ''
      setError(`${reason instanceof Error ? reason.message : 'Не удалось сохранить заявку'}${duplicateTime}`)
      if (reason instanceof ApiError && reason.status === 409) setDuplicateRequestId(reason.requestId ?? null)
    } finally {
      setBusy(false)
    }
  }

  function openDuplicateRequest() {
    if (duplicateRequestId === null || !requests.some((request) => request.id === duplicateRequestId)) return
    setRequestLimit(10)
    setFilter('all')
    setSearch(String(duplicateRequestId))
    closeModal()
    window.setTimeout(() => {
      document.getElementById(`request-${duplicateRequestId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, MODAL_TRANSITION_MS)
  }

  function openCompletion(request: RequestRecord) {
    setSelectedRequest(request)
    setFields({ ...emptyFields, creation_date: request.creation_date ?? new Date().toISOString().slice(0, 10), nomenclature: request.nomenclature ?? '' })
    setError('')
    openModal('complete')
  }

  async function saveCompletion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!selectedRequest) return
    setBusy(true)
    setError('')
    try {
      const result = await api<RequestRecord>(`/requests/${selectedRequest.id}/complete`, token, {
        method: 'POST',
        body: JSON.stringify({ creation_date: fields.creation_date, nomenclature: fields.nomenclature }),
      })
      setRequests((current) => current.map((request) => request.id === result.id ? result : request))
      closeModal()
      setNotice(selectedRequest.is_completed ? 'Изменения сохранены' : 'Заявка выполнена')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить номенклатуру')
    } finally {
      setBusy(false)
    }
  }

  function openUserForm(target?: User) {
    setEditingUser(target ?? null)
    setUserForm({ username: target?.username ?? '', full_name: target?.full_name ?? '', role: target?.role ?? 'manager', password: '' })
    setError('')
    openModal('user')
  }

  async function saveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const body = { ...userForm, password: userForm.password || null }
      const result = await api<User>(editingUser ? `/users/${editingUser.id}` : '/users', token, {
        method: editingUser ? 'PUT' : 'POST',
        body: JSON.stringify(body),
      })
      if (user?.id === result.id) setUser(result)
      setUsers((current) => editingUser
        ? current.map((item) => item.id === result.id ? result : item)
        : [...current, result].sort((a, b) => a.username.localeCompare(b.username, 'ru')))
      closeModal()
      setNotice(editingUser ? 'Пользователь обновлён' : 'Пользователь добавлен')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить пользователя')
    } finally {
      setBusy(false)
    }
  }

  function deleteUser(target: User) {
    setPendingDeletion({ type: 'user', target })
    setError('')
    openModal('confirm-delete')
  }

  function deleteRequest(request: RequestRecord) {
    setPendingDeletion({ type: 'request', target: request })
    setError('')
    openModal('confirm-delete')
  }

  async function confirmDeletion() {
    if (!pendingDeletion) return
    setBusy(true)
    setError('')
    try {
      if (pendingDeletion.type === 'user') {
        await api(`/users/${pendingDeletion.target.id}`, token, { method: 'DELETE' })
        setUsers((current) => current.filter((item) => item.id !== pendingDeletion.target.id))
        setNotice('Пользователь удалён')
      } else {
        await api(`/requests/${pendingDeletion.target.id}`, token, { method: 'DELETE' })
        setRequests((current) => current.filter((item) => item.id !== pendingDeletion.target.id))
        setNotice('Заявка удалена')
      }
      closeModal()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить запись')
    } finally {
      setBusy(false)
    }
  }

  if (!user) {
    return (
      <main className="auth-page">
        <div className="auth-glow auth-glow-one" />
        <div className="auth-glow auth-glow-two" />
        <section className="auth-card">
          <div className="brand-mark large-mark"><img src={brandIcon} alt="" draggable={false} /></div>
          <div className="eyebrow">ЮВЕЛИРНЫЙ ДОМ</div>
          <h1>Заявки на номенклатуру</h1>
          <p className="auth-subtitle">Дмитрий Федоров</p>
          <form onSubmit={handleLogin} className="auth-form">
            <label>Логин<input name="username" autoComplete="username" placeholder="Ваш логин" required /></label>
            <label>Пароль<input name="password" type="password" autoComplete="current-password" placeholder="Ваш пароль" required /></label>
            {error && <div className="form-error">{error}</div>}
            {notice && <div className="form-success">{notice}</div>}
            <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Выполняется…' : 'Войти в систему'}</button>
          </form>
          {/* <div className="auth-footer">*/}
          {/*   <span>Защищённый доступ для сотрудников</span>*/}
          {/*   <button className="text-button" onClick={() => { setSetupOpen((open) => !open); setError('') }}>*/}
          {/*     {setupOpen ? 'Скрыть' : 'Первый запуск'}*/}
          {/*   </button>*/}
          {/* </div>*/}
          {setupOpen && <div className="setup-box">
            <p>Создайте администратора и таблицы базы данных. Логин и пароль задаются в переменных <code>ADMIN_LOGIN</code> и <code>ADMIN_PASSWORD</code> сервера.</p>
            <button className="button button-secondary" onClick={() => void initializeSystem()} disabled={busy}>Инициализировать систему</button>
          </div>}
        </section>
        <div className="auth-caption">Дмитрий Федоров · Запросник</div>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <aside className="app-sidebar">
        <a className="brand" href="#" aria-label="На главную" onClick={(event) => { event.preventDefault(); setActiveTab('requests') }}>
          <span className="brand-mark"><img src={brandIcon} alt="" draggable={false} /></span>
          <span className="brand-title">Дмитрий Федоров <small>ЮВЕЛИРНЫЙ ДОМ</small></span>
        </a>
        <nav className="sidebar-nav" aria-label="Основная навигация">
          <span className="sidebar-group-title">РАБОТА</span>
          <button className={`sidebar-link${activeTab === 'requests' ? ' active' : ''}`} onClick={() => setActiveTab('requests')} aria-current={activeTab === 'requests' ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><rect x="14" y="14" width="6" height="6" rx="1" /></svg><span>Заявки</span>
          </button>
          {user.role === 'admin' && <>
            <span className="sidebar-group-title">УПРАВЛЕНИЕ</span>
            <button className={`sidebar-link${activeTab === 'users' ? ' active' : ''}`} onClick={() => setActiveTab('users')} aria-current={activeTab === 'users' ? 'page' : undefined}>
              <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3" /><path d="M3.5 19c.5-3 2.3-4.5 5.5-4.5s5 1.5 5.5 4.5M16 5.5a3 3 0 0 1 0 5.8M17 14.8c2.1.5 3.3 1.9 3.5 4.2" /></svg><span>Пользователи</span>
            </button>
          </>}
        </nav>
        <div className="sidebar-bottom">
          <div className="user-chip"><span className="user-avatar">{(user.full_name || user.username).slice(0, 1).toUpperCase()}</span><span className="user-meta"><b>{user.full_name || user.username}</b><small>{ROLE_LABELS[user.role]}</small></span></div>
          <button className="icon-button logout-button" title="Выйти" onClick={() => void logout()} aria-label="Выйти"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M3 10h13m-5-5 5 5-5 5" /></svg></button>
        </div>
      </aside>
      <div className="app-main">
        <header className="topbar">
          <div className="live-indicator"><i /> Данные обновляются автоматически</div>
          <div className="topbar-right">
            <span className="user-meta topbar-user"><b>{user.full_name || user.username}</b><small>{user.username}</small></span>
            <span className="user-avatar topbar-avatar">{(user.full_name || user.username).slice(0, 1).toUpperCase()}</span>
          </div>
        </header>

      <main className="main-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО / {activeTab === 'users' ? 'СОТРУДНИКИ' : 'НОМЕНКЛАТУРА'}</div>
            <h1>{activeTab === 'users' ? 'Команда' : 'Заявки на номенклатуру'}</h1>
            <p>{activeTab === 'users' ? 'Управление доступом и ролями сотрудников' : user.role === 'manager' ? 'Ваши запросы на создание новых изделий' : 'Все запросы на создание новых изделий'}</p>
          </div>
          <div className="heading-actions">
            {activeTab === 'requests' && (user.role === 'manager' || user.role === 'admin') && <button className="button button-primary" onClick={() => openRequestForm('create')}><span className="plus"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M3 10h14" /></svg></span> Создать запрос</button>}
            {activeTab === 'users' && <button className="button button-primary" onClick={() => openUserForm()}><span className="plus"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 3v14M3 10h14" /></svg></span> Добавить пользователя</button>}
          </div>
        </div>

        {error && <div className="notice notice-error"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></div>}
        {notice && <div className="notice notice-success"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрыть"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></div>}

        {activeTab === 'requests' ? <>
          <section className="stats-grid" aria-label="Статистика заявок">
            <article className="stat-card"><div className="stat-icon gold-icon">◈</div><div><span className="stat-label">Всего заявок</span><strong>{requests.length.toString().padStart(2, '0')}</strong></div><span className="stat-caption">за всё время</span></article>
            <article className="stat-card"><div className="stat-icon amber-icon">◷</div><div><span className="stat-label">Ожидают обработки</span><strong>{newCount.toString().padStart(2, '0')}</strong></div><span className="stat-caption">новые запросы</span></article>
            <article className="stat-card"><div className="stat-icon green-icon"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg></div><div><span className="stat-label">Выполнено</span><strong>{doneCount.toString().padStart(2, '0')}</strong></div><span className="stat-caption">готовая номенклатура</span></article>
          </section>
          <section className="list-section">
            <div className="list-toolbar">
              <div className="section-title"><h2>Список заявок</h2><span className="count-pill">{filteredRequests.length}</span></div>
              <div className="toolbar-controls">
                <label className="search-box"><span className="search-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg></span><input value={search} onChange={(event) => { setRequestLimit(10); setSearch(event.target.value) }} placeholder="Поиск по заявкам…" aria-label="Поиск по заявкам" /><kbd>⌘ K</kbd></label>
                <div className="filter-tabs" role="group" aria-label="Фильтр заявок">
                  <button className={filter === 'all' ? 'active' : ''} onClick={() => { setRequestLimit(10); setFilter('all') }}>Все</button>
                  <button className={filter === 'new' ? 'active' : ''} onClick={() => { setRequestLimit(10); setFilter('new') }}>Новые <span>{newCount}</span></button>
                  <button className={filter === 'done' ? 'active' : ''} onClick={() => { setRequestLimit(10); setFilter('done') }}>Готовые</button>
                </div>
              </div>
            </div>
            {visibleRequests.length ? <div className="request-list">
              {visibleRequests.map((request) => (
                <article className={`request-card ${request.is_completed ? 'request-done' : 'request-new'}`} id={`request-${request.id}`} key={request.id}>
                  <div className="request-layout">
                    <div className="request-image-cell">
                      {request.image_url
                        ? <button className="request-image-frame" onClick={() => { if (request.image_url) openImagePreview(request.image_url) }} aria-label={`Увеличить изображение: ${request.model}`}>
                            <img src={request.image_url} alt={`Изделие: ${request.model}`} draggable={false} />
                            <span className="request-image-hint">Нажмите, чтобы увеличить</span>
                          </button>
                        : <div className="request-image-frame request-image-placeholder">
                            <span className="request-image-dash">—</span>
                          </div>}
                    </div>
                    <div className="request-content">
                      <div className="request-identity">
                        <div className={`request-symbol ${request.is_completed ? 'symbol-done' : ''}`}>{request.is_completed ? <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m5 12 4.5 4.5L19 7" /></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.25 20.75 12 12 20.75 3.25 12 12 3.25Z" /><path d="m12 9 3 3-3 3-3-3 3-3Z" /></svg>}</div>
                        <div>
                          <div className="request-title-line"><h3>{displayValue(request.model)}</h3><span className={`status-badge ${request.is_completed ? 'status-done' : 'status-new'}`}><i />{request.is_completed ? 'Готово' : 'Новая'}</span></div>
                        </div>
                      </div>
                      <div className="request-fields">
                        <RequestField label="Отметка времени" value={formatTimestamp(request.timestamp)} />
                        <RequestField label="От кого заявка" value={displayValue(request.requester)} />
                        <RequestField label="Тип изделия" value={displayValue(request.item_type)} />
                        <RequestField label="Модель" value={displayValue(request.model)} />
                        <RequestField label="Кастом" value={request.is_custom ? 'Да' : 'Нет'} />
                        <RequestField label="Размер" value={displayValue(request.size)} />
                        <RequestField label="Материал основы" value={displayValue(request.base_material)} />
                        <RequestField label="Материал тела" value={displayValue(request.body_material)} />
                        <RequestField label="Материал доп" value={displayValue(request.additional_material)} />
                        <RequestField label="Покрытие" value={displayValue(request.coating)} />
                        <RequestField label="Прочие материалы" value={displayValue(request.other_materials)} />
                        <RequestField label="Номер заказа" value={displayValue(request.order_number)} />
                        <RequestField label="Примечание" value={displayValue(request.note)} scrollable />
                        <RequestField label="Дата создания" value={request.creation_date ? formatDate(request.creation_date) : '—'} highlighted />
                        <RequestField label="Номенклатура" value={displayValue(request.nomenclature)} highlighted />
                      </div>
                    </div>
                  </div>
                  <div className="request-footer">
                    <div className="request-actions">
                      {(user.role === 'operator' || user.role === 'admin') && <button className="button button-small button-primary" onClick={() => openCompletion(request)}>{request.is_completed ? 'Изменить артикул' : 'Заполнить'}</button>}
                      {user.role === 'admin' && <button className="button button-small button-outline" onClick={() => openRequestForm('edit', request)}>Изменить</button>}
                      {user.role === 'admin' && <button className="icon-button delete-button" onClick={() => deleteRequest(request)} title="Удалить заявку" aria-label="Удалить заявку"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>}
                    </div>
                  </div>
                </article>
              ))}
              {visibleRequests.length < filteredRequests.length && <button className="button button-outline load-more" onClick={() => setRequestLimit((current) => current + 5)}>Показать ещё</button>}
            </div> : <div className="empty-state"><div className="empty-icon">◈</div><h3>{search || filter !== 'all' ? 'Ничего не найдено' : 'Заявок пока нет'}</h3><p>{search || filter !== 'all' ? 'Измените поисковый запрос или фильтр.' : user.role === 'manager' || user.role === 'admin' ? 'Создайте первый запрос — он появится здесь.' : 'Новые запросы появятся в этом списке.'}</p>{(user.role === 'manager' || user.role === 'admin') && !search && filter === 'all' && <button className="button button-primary" onClick={() => openRequestForm('create')}>Создать запрос</button>}</div>}
          </section>
        </> : <section className="users-section">
          <div className="list-toolbar"><div className="section-title"><h2>Пользователи</h2><span className="count-pill">{filteredUsers.length}</span></div><label className="search-box user-search"><span className="search-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><circle cx="8.5" cy="8.5" r="5.5" /><path d="m12.5 12.5 4 4" /></svg></span><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Поиск по пользователям…" aria-label="Поиск по пользователям" /></label></div>
          <div className="users-table">
            <div className="users-head"><span>Сотрудник</span><span>Роль</span><span>Действия</span></div>
            {filteredUsers.length ? filteredUsers.map((item) => <div className="users-row" key={item.id}><div className="user-row-name"><span className="user-avatar">{(item.full_name || item.username).slice(0, 1).toUpperCase()}</span><span className="user-row-details"><b>{item.full_name || 'ФИО не указано'}</b><small>{item.username}</small></span>{item.id === user.id && <span className="you-label">Это вы</span>}</div><span className={`role-pill role-${item.role}`}>{ROLE_LABELS[item.role]}</span><div className="user-row-actions"><button className="button button-small button-outline" onClick={() => openUserForm(item)}>Изменить</button>{item.id !== user.id && <button className="icon-button delete-button" onClick={() => deleteUser(item)} title={`Удалить ${item.username}`} aria-label={`Удалить ${item.username}`}><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button>}</div></div>) : <div className="users-empty">{userSearch.trim() ? 'Пользователи не найдены' : 'Список пользователей пуст'}</div>}
          </div>
        </section>}
        <footer className="page-footer"><span>DF REQUESTER <i>·</i> ЮВЕЛИРНЫЙ ДОМ ДМИТРИЯ ФЕДОРОВА</span><span>Все изменения сохраняются автоматически</span></footer>
      </main>
      </div>

      {previewImage && <div className={`image-lightbox${closingPreview ? ' image-lightbox-closing' : ''}`} role="dialog" aria-modal="true" aria-label="Просмотр изображения" onClick={closeImagePreview}>
        <button className="image-lightbox-close" onClick={(event) => { event.stopPropagation(); closeImagePreview() }} aria-label="Закрыть изображение"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18" /></svg></button>
        <img src={previewImage} alt="Увеличенное изображение изделия" draggable={false} onClick={(event) => event.stopPropagation()} />
      </div>}

      {modal && <div className={`modal-backdrop${closingModal ? ' modal-backdrop-closing' : ''}`} onMouseDown={(event) => { if (event.target === event.currentTarget && !busy && !closingModal) closeModal() }}>
        <section className={`modal-card${closingModal ? ' modal-card-closing' : ''} ${modal === 'create' || modal === 'edit' ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-heading"><div><div className="eyebrow">{modal === 'user' ? 'УПРАВЛЕНИЕ ДОСТУПОМ' : modal === 'complete' ? 'ОБРАБОТКА ЗАЯВКИ' : modal === 'edit' ? `ЗАЯВКА №${selectedRequest?.id}` : modal === 'confirm-delete' ? 'ПОДТВЕРЖДЕНИЕ ДЕЙСТВИЯ' : 'Новая номенклатура'}</div><h2 id="modal-title">{modal === 'user' ? editingUser ? 'Изменить пользователя' : 'Новый пользователь' : modal === 'complete' ? selectedRequest?.is_completed ? 'Изменить номенклатуру' : 'Завершить заявку' : modal === 'edit' ? 'Редактировать заявку' : modal === 'confirm-delete' ? 'Удалить?' : 'Создать запрос'}</h2></div><button className="icon-button modal-close" onClick={closeModal} aria-label="Закрыть"><svg viewBox="0 0 20 20" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" /></svg></button></div>
          {modal === 'confirm-delete' ? <div className="delete-confirmation">
            <p>{pendingDeletion?.type === 'user' ? <>Вы уверены, что хотите удалить пользователя <b>«{pendingDeletion.target.username}»</b>? Это действие нельзя отменить.</> : <>Вы уверены, что хотите удалить заявку <b>№{pendingDeletion?.target.id}</b>? Это действие нельзя отменить.</>}</p>
            <div className="confirm-actions"><button type="button" className="button button-primary" onClick={() => void confirmDeletion()} disabled={busy}>{busy ? 'Удаление…' : 'Да'}</button><button type="button" className="button button-quiet" onClick={closeModal} disabled={busy}>Отмена</button></div>
          </div> : modal === 'create' || modal === 'edit' ? <form onSubmit={saveRequest} className="modal-form">
            <div className="form-section-label">Основная информация</div>
            <div className="form-grid request-main-grid">
              {modal === 'edit' && user.role === 'admin' && <label>От кого заявка<input value={fields.requester} onChange={(event) => setField('requester', event.target.value)} required /></label>}
              <label>Тип изделия<select value={fields.item_type} onChange={(event) => setField('item_type', event.target.value)} required><option value="" disabled>Выберите тип</option>{ITEM_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Модель<input value={fields.model} onChange={(event) => setField('model', event.target.value)} placeholder="Название или артикул модели" required /></label>
              <label>Кастом<select value={fields.is_custom} onChange={(event) => setField('is_custom', event.target.value)}><option value="false">Нет</option><option value="true">Да</option></select></label>
              <label>Размер<input value={fields.size} onChange={(event) => setField('size', event.target.value)} placeholder="Например, 17.5" /></label>
              <label>Номер заказа<input value={fields.order_number} onChange={(event) => setField('order_number', event.target.value)} placeholder="Если есть" /></label>
            </div>
            <div className="form-section-label">Материалы и покрытие</div>
            <div className="form-grid material-grid">
              <label>Материал основы<input value={fields.base_material} onChange={(event) => setField('base_material', event.target.value)} placeholder="Например, серебро 925" /></label>
              <label>Материал тела<input value={fields.body_material} onChange={(event) => setField('body_material', event.target.value)} placeholder="Уточните материал" /></label>
              <label>Материал дополнительный<input value={fields.additional_material} onChange={(event) => setField('additional_material', event.target.value)} placeholder="При наличии" /></label>
              <label>Покрытие<select value={fields.coating} onChange={(event) => setField('coating', event.target.value)}><option value="">Не указано</option>{COATINGS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field-half">Прочие материалы<textarea value={fields.other_materials} onChange={(event) => setField('other_materials', event.target.value)} placeholder="Камни, цвет, цвет эмали и другие детали" rows={2} /></label>
              <label className="field-half">Примечание<textarea value={fields.note} onChange={(event) => setField('note', event.target.value)} placeholder="Дополнительная информация для оператора" rows={2} /></label>
            </div>
            <div className="form-section-label">{fields.is_custom === 'true' ? 'Изображение · обязательно для кастома' : 'Изображение'}</div>
            <label className={`upload-zone ${fields.is_custom === 'true' && !image && !selectedRequest?.image_url ? 'upload-required' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setImage(event.target.files?.[0] ?? null); setRemoveImage(false) }} />
              <span className="upload-icon" aria-hidden="true"><svg viewBox="0 0 20 20"><path d="M10 13V3m-4 4 4-4 4 4M4 13v3h12v-3" /></svg></span><span><b>{image?.name ?? (selectedRequest?.image_url && !removeImage ? 'Изображение уже загружено' : 'Нажмите, чтобы выбрать файл')}</b><small>JPG, PNG или WebP · до 10 МБ {fields.is_custom === 'true' ? '· обязательно' : ''}</small></span>
              {selectedRequest?.image_url && !image && <button type="button" className="text-button remove-image" onClick={(event) => { event.preventDefault(); setRemoveImage(true) }}>{removeImage ? 'Удалено' : 'Убрать'}</button>}
            </label>
            {modal === 'edit' && user.role === 'admin' && <><div className="form-section-label">Результат обработки</div><div className="form-grid"><label>Дата создания<input type="date" value={fields.creation_date} onChange={(event) => setField('creation_date', event.target.value)} /></label><label>Номенклатура<input value={fields.nomenclature} onChange={(event) => setField('nomenclature', event.target.value)} placeholder="Заполняет оператор" /></label></div></>}
            {error && <div className="form-error"><span>{error}</span>{duplicateRequestId !== null && requests.some((request) => request.id === duplicateRequestId) && <button type="button" className="text-button duplicate-link" onClick={openDuplicateRequest}>Открыть заявку №{duplicateRequestId}</button>}</div>}
            <div className="modal-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить заявку'}</button><button type="button" className="button button-quiet" onClick={closeModal}>Отмена</button></div>
          </form> : modal === 'complete' ? <form onSubmit={saveCompletion} className="modal-form compact-form">
            <div className="request-summary"><span className="request-symbol">{selectedRequest?.item_type.slice(0, 1)}</span><div><b>{selectedRequest?.model}</b><small>{selectedRequest?.item_type} · заявка №{selectedRequest?.id}</small></div></div>
            <label>Дата создания<input type="date" value={fields.creation_date} onChange={(event) => setField('creation_date', event.target.value)} required /></label>
            <label>Номенклатура<input value={fields.nomenclature} onChange={(event) => setField('nomenclature', event.target.value)} placeholder="Введите артикул" required /></label>
            <p className="form-hint">После сохранения заявка будет отмечена как выполненная.</p>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button><button type="button" className="button button-quiet" onClick={closeModal}>Отмена</button></div>
          </form> : <form onSubmit={saveUser} className="modal-form compact-form">
            <label>Логин<input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} autoComplete="off" required /></label>
            <label>Фамилия и имя<input value={userForm.full_name} onChange={(event) => setUserForm((current) => ({ ...current, full_name: event.target.value }))} placeholder="Фамилия Имя Отчество" maxLength={120} required /></label>
            <label>Роль<select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value as Role }))}><option value="manager">Менеджер</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label>
            <label>Пароль<input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={editingUser ? 'Оставьте пустым, чтобы не менять' : 'Не менее 8 символов'} minLength={editingUser ? undefined : 8} required={!editingUser} autoComplete="new-password" /></label>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions"><button className="button button-primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'}</button><button type="button" className="button button-quiet" onClick={closeModal}>Отмена</button></div>
          </form>}
        </section>
      </div>}
    </div>
  )
}

export default App
