import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react'
import './App.css'

type Role = 'manager' | 'operator' | 'admin'
type User = { id: number; username: string; role: Role }
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
type Modal = 'create' | 'edit' | 'complete' | 'user' | null
type UserForm = { username: string; role: Role; password: string }

const API_URL = import.meta.env.VITE_API_URL ?? '/api'
const ITEM_TYPES = ['Браслет', 'Вставка', 'Значок', 'Икона', 'Колье', 'Кольцо', 'Крест', 'Подвеска', 'Серьги', 'Сувенир', 'Цепи', 'Четки']
const COATINGS = ['Без покрытия', 'Чернение', 'Белый родий', 'Черный родий', 'Черный рутений', 'Желтое золочение', 'Красное золочение', 'Нанокерамика', 'Платинирование', 'Комбинированное покрытие']
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
  const [selectedRequest, setSelectedRequest] = useState<RequestRecord | null>(null)
  const [fields, setFields] = useState<RequestFields>(emptyFields)
  const [image, setImage] = useState<File | null>(null)
  const [previewImage, setPreviewImage] = useState<string | null>(null)
  const [removeImage, setRemoveImage] = useState(false)
  const [userForm, setUserForm] = useState<UserForm>({ username: '', role: 'manager', password: '' })
  const [editingUser, setEditingUser] = useState<User | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [duplicateRequestId, setDuplicateRequestId] = useState<number | null>(null)
  const [notice, setNotice] = useState('')
  const [setupOpen, setSetupOpen] = useState(false)

  useEffect(() => {
    if (!previewImage) return
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setPreviewImage(null)
    }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [previewImage])

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
    return users.filter((item) => [item.username, ROLE_LABELS[item.role]]
      .some((value) => value.toLocaleLowerCase('ru').includes(query)))
  }, [users, userSearch])

  const newCount = requests.filter((request) => !request.is_completed).length
  const doneCount = requests.length - newCount

  function setField<K extends keyof RequestFields>(key: K, value: RequestFields[K]) {
    setFields((current) => ({ ...current, [key]: value }))
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
    } : { ...emptyFields, requester: user?.username ?? '' })
    setModal(mode)
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
      setModal(null)
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
    setModal(null)
    window.setTimeout(() => {
      document.getElementById(`request-${duplicateRequestId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 0)
  }

  function openCompletion(request: RequestRecord) {
    setSelectedRequest(request)
    setFields({ ...emptyFields, creation_date: request.creation_date ?? new Date().toISOString().slice(0, 10), nomenclature: request.nomenclature ?? '' })
    setError('')
    setModal('complete')
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
      setModal(null)
      setNotice(selectedRequest.is_completed ? 'Изменения сохранены' : 'Заявка выполнена')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить номенклатуру')
    } finally {
      setBusy(false)
    }
  }

  function openUserForm(target?: User) {
    setEditingUser(target ?? null)
    setUserForm({ username: target?.username ?? '', role: target?.role ?? 'manager', password: '' })
    setError('')
    setModal('user')
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
      setUsers((current) => editingUser
        ? current.map((item) => item.id === result.id ? result : item)
        : [...current, result].sort((a, b) => a.username.localeCompare(b.username, 'ru')))
      setModal(null)
      setNotice(editingUser ? 'Пользователь обновлён' : 'Пользователь добавлен')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить пользователя')
    } finally {
      setBusy(false)
    }
  }

  async function deleteUser(target: User) {
    if (!window.confirm(`Удалить пользователя «${target.username}»?`)) return
    try {
      await api(`/users/${target.id}`, token, { method: 'DELETE' })
      setUsers((current) => current.filter((item) => item.id !== target.id))
      setNotice('Пользователь удалён')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить пользователя')
    }
  }

  async function deleteRequest(request: RequestRecord) {
    if (!window.confirm(`Удалить заявку №${request.id}? Это действие нельзя отменить.`)) return
    try {
      await api(`/requests/${request.id}`, token, { method: 'DELETE' })
      setRequests((current) => current.filter((item) => item.id !== request.id))
      setNotice('Заявка удалена')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось удалить заявку')
    }
  }

  if (!user) {
    return (
      <main className="auth-page">
        <div className="auth-glow auth-glow-one" />
        <div className="auth-glow auth-glow-two" />
        <section className="auth-card">
          <div className="brand-mark large-mark"><svg viewBox="0 0 42 42" aria-hidden="true"><path d="M8 13 14 6h14l6 7-13 23L8 13Z" /><path d="m8 13 13 2 13-2M14 6l7 9 7-9M15 15l6 21 6-21" /></svg></div>
          <div className="eyebrow">ЮВЕЛИРНЫЙ ДОМ</div>
          <h1>Заявки на номенклатуру</h1>
          <p className="auth-subtitle">Дмитрий Фёдоров</p>
          <form onSubmit={handleLogin} className="auth-form">
            <label>Логин<input name="username" autoComplete="username" placeholder="Ваш логин" required /></label>
            <label>Пароль<input name="password" type="password" autoComplete="current-password" placeholder="Ваш пароль" required /></label>
            {error && <div className="form-error">{error}</div>}
            {notice && <div className="form-success">{notice}</div>}
            <button className="button button-primary auth-submit" disabled={busy}>{busy ? 'Выполняется…' : 'Войти в систему'}<span aria-hidden="true">→</span></button>
          </form>
          <div className="auth-footer">
            <span>Защищённый доступ для сотрудников</span>
            <button className="text-button" onClick={() => { setSetupOpen((open) => !open); setError('') }}>
              {setupOpen ? 'Скрыть' : 'Первый запуск'}
            </button>
          </div>
          {setupOpen && <div className="setup-box">
            <p>Создайте администратора и таблицы базы данных. Логин и пароль задаются в переменных <code>ADMIN_LOGIN</code> и <code>ADMIN_PASSWORD</code> сервера.</p>
            <button className="button button-secondary" onClick={() => void initializeSystem()} disabled={busy}>Инициализировать систему</button>
          </div>}
        </section>
        <div className="auth-caption">DF · WORKSPACE</div>
      </main>
    )
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="На главную" onClick={(event) => { event.preventDefault(); setActiveTab('requests') }}>
          <span className="brand-mark"><svg viewBox="0 0 42 42" aria-hidden="true"><path d="M8 13 14 6h14l6 7-13 23L8 13Z" /><path d="m8 13 13 2 13-2M14 6l7 9 7-9M15 15l6 21 6-21" /></svg></span>
          <span className="brand-title">ДФ <small>ЮВЕЛИРНЫЙ ДОМ</small></span>
        </a>
        <div className="topbar-right">
          <div className="live-indicator"><i /> Данные обновляются автоматически</div>
          <span className="topbar-divider" />
          <div className="user-chip"><span className="user-avatar">{user.username.slice(0, 1).toUpperCase()}</span><span className="user-meta"><b>{user.username}</b><small>{ROLE_LABELS[user.role]}</small></span></div>
          <button className="icon-button logout-button" title="Выйти" onClick={() => void logout()} aria-label="Выйти">↗</button>
        </div>
      </header>

      <main className="main-content">
        <div className="page-heading">
          <div>
            <div className="eyebrow">РАБОЧЕЕ ПРОСТРАНСТВО / {activeTab === 'users' ? 'СОТРУДНИКИ' : 'НОМЕНКЛАТУРА'}</div>
            <h1>{activeTab === 'users' ? 'Команда' : 'Заявки на номенклатуру'}<span className="heading-period">.</span></h1>
            <p>{activeTab === 'users' ? 'Управление доступом и ролями сотрудников' : user.role === 'manager' ? 'Ваши запросы на создание новых изделий' : 'Все запросы на создание новых изделий'}</p>
          </div>
          <div className="heading-actions">
            {user.role === 'admin' && <button className={`button button-quiet ${activeTab === 'users' ? 'selected' : ''}`} onClick={() => setActiveTab(activeTab === 'users' ? 'requests' : 'users')}>{activeTab === 'users' ? '← К заявкам' : '♙ Реестр пользователей'}</button>}
            {activeTab === 'requests' && (user.role === 'manager' || user.role === 'admin') && <button className="button button-primary" onClick={() => openRequestForm('create')}><span className="plus">+</span> Создать запрос</button>}
            {activeTab === 'users' && <button className="button button-primary" onClick={() => openUserForm()}><span className="plus">+</span> Добавить пользователя</button>}
          </div>
        </div>

        {error && <div className="notice notice-error"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть">×</button></div>}
        {notice && <div className="notice notice-success"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрыть">×</button></div>}

        {activeTab === 'requests' ? <>
          <section className="stats-grid" aria-label="Статистика заявок">
            <article className="stat-card"><div className="stat-icon gold-icon">◈</div><div><span className="stat-label">Всего заявок</span><strong>{requests.length.toString().padStart(2, '0')}</strong></div><span className="stat-caption">за всё время</span></article>
            <article className="stat-card"><div className="stat-icon amber-icon">◷</div><div><span className="stat-label">Ожидают обработки</span><strong>{newCount.toString().padStart(2, '0')}</strong></div><span className="stat-caption">новые запросы</span></article>
            <article className="stat-card"><div className="stat-icon green-icon">✓</div><div><span className="stat-label">Выполнено</span><strong>{doneCount.toString().padStart(2, '0')}</strong></div><span className="stat-caption">готовая номенклатура</span></article>
          </section>
          <section className="list-section">
            <div className="list-toolbar">
              <div className="section-title"><h2>Список заявок</h2><span className="count-pill">{filteredRequests.length}</span></div>
              <div className="toolbar-controls">
                <label className="search-box"><span aria-hidden="true">⌕</span><input value={search} onChange={(event) => { setRequestLimit(10); setSearch(event.target.value) }} placeholder="Поиск по заявкам…" aria-label="Поиск по заявкам" /><kbd>⌘ K</kbd></label>
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
                        ? <button className="request-image-frame" onClick={() => setPreviewImage(request.image_url)} aria-label={`Увеличить изображение: ${request.model}`}>
                            <img src={request.image_url} alt={`Изделие: ${request.model}`} />
                            <span className="request-image-hint">Нажмите, чтобы увеличить</span>
                          </button>
                        : <div className="request-image-frame request-image-placeholder">
                            <span className="request-image-dash">—</span>
                          </div>}
                    </div>
                    <div className="request-content">
                      <div className="request-identity">
                        <div className={`request-symbol ${request.is_completed ? 'symbol-done' : ''}`}>{request.is_completed ? '✓' : '◈'}</div>
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
                      {(user.role === 'operator' || user.role === 'admin') && <button className="button button-small button-primary" onClick={() => openCompletion(request)}>{request.is_completed ? 'Изменить артикул' : 'Заполнить'} <span>→</span></button>}
                      {user.role === 'admin' && <button className="button button-small button-outline" onClick={() => openRequestForm('edit', request)}>Изменить</button>}
                      {user.role === 'admin' && <button className="icon-button delete-button" onClick={() => void deleteRequest(request)} title="Удалить заявку" aria-label="Удалить заявку">×</button>}
                    </div>
                  </div>
                </article>
              ))}
              {visibleRequests.length < filteredRequests.length && <button className="button button-outline load-more" onClick={() => setRequestLimit((current) => current + 5)}>Показать ещё</button>}
            </div> : <div className="empty-state"><div className="empty-icon">◈</div><h3>{search || filter !== 'all' ? 'Ничего не найдено' : 'Заявок пока нет'}</h3><p>{search || filter !== 'all' ? 'Измените поисковый запрос или фильтр.' : user.role === 'manager' || user.role === 'admin' ? 'Создайте первый запрос — он появится здесь.' : 'Новые запросы появятся в этом списке.'}</p>{(user.role === 'manager' || user.role === 'admin') && !search && filter === 'all' && <button className="button button-primary" onClick={() => openRequestForm('create')}>Создать запрос</button>}</div>}
          </section>
        </> : <section className="users-section">
          <div className="list-toolbar"><div className="section-title"><h2>Пользователи</h2><span className="count-pill">{filteredUsers.length}</span></div><label className="search-box user-search"><span aria-hidden="true">⌕</span><input value={userSearch} onChange={(event) => setUserSearch(event.target.value)} placeholder="Поиск по пользователям…" aria-label="Поиск по пользователям" /></label></div>
          <div className="users-table">
            <div className="users-head"><span>Сотрудник</span><span>Роль</span><span>Действия</span></div>
            {filteredUsers.length ? filteredUsers.map((item) => <div className="users-row" key={item.id}><div className="user-row-name"><span className="user-avatar">{item.username.slice(0, 1).toUpperCase()}</span><b>{item.username}</b>{item.id === user.id && <span className="you-label">Это вы</span>}</div><span className={`role-pill role-${item.role}`}>{ROLE_LABELS[item.role]}</span><div className="user-row-actions"><button className="button button-small button-outline" onClick={() => openUserForm(item)}>Изменить</button>{item.id !== user.id && <button className="icon-button delete-button" onClick={() => void deleteUser(item)} aria-label={`Удалить ${item.username}`}>×</button>}</div></div>) : <div className="users-empty">{userSearch.trim() ? 'Пользователи не найдены' : 'Список пользователей пуст'}</div>}
          </div>
        </section>}
        <footer className="page-footer"><span>DF REQUESTER <i>·</i> ЮВЕЛИРНЫЙ ДОМ ДМИТРИЯ ФЁДОРОВА</span><span>Все изменения сохраняются автоматически</span></footer>
      </main>

      {previewImage && <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="Просмотр изображения" onClick={() => setPreviewImage(null)}>
        <button className="image-lightbox-close" onClick={(event) => { event.stopPropagation(); setPreviewImage(null) }} aria-label="Закрыть изображение">×</button>
        <img src={previewImage} alt="Увеличенное изображение изделия" onClick={(event) => event.stopPropagation()} />
      </div>}

      {modal && <div className="modal-backdrop" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setModal(null) }}>
        <section className={`modal-card ${modal === 'create' || modal === 'edit' ? 'modal-wide' : ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="modal-heading"><div><div className="eyebrow">{modal === 'user' ? 'УПРАВЛЕНИЕ ДОСТУПОМ' : modal === 'complete' ? 'ОБРАБОТКА ЗАЯВКИ' : modal === 'edit' ? `ЗАЯВКА №${selectedRequest?.id}` : 'НОВАЯ НОМЕНКЛАТУРА'}</div><h2 id="modal-title">{modal === 'user' ? editingUser ? 'Изменить пользователя' : 'Новый пользователь' : modal === 'complete' ? selectedRequest?.is_completed ? 'Изменить номенклатуру' : 'Завершить заявку' : modal === 'edit' ? 'Редактировать заявку' : 'Создать запрос'}</h2></div><button className="icon-button modal-close" onClick={() => setModal(null)} aria-label="Закрыть">×</button></div>
          {modal === 'create' || modal === 'edit' ? <form onSubmit={saveRequest} className="modal-form">
            <div className="form-section-label">Основная информация</div>
            <div className="form-grid">
              {modal === 'edit' && user.role === 'admin' && <label>От кого заявка<input value={fields.requester} onChange={(event) => setField('requester', event.target.value)} required /></label>}
              <label>Тип изделия<select value={fields.item_type} onChange={(event) => setField('item_type', event.target.value)} required><option value="" disabled>Выберите тип</option>{ITEM_TYPES.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label>Модель<input value={fields.model} onChange={(event) => setField('model', event.target.value)} placeholder="Название или артикул модели" required /></label>
              <label>Кастом<select value={fields.is_custom} onChange={(event) => setField('is_custom', event.target.value)}><option value="false">Нет</option><option value="true">Да</option></select></label>
              <label>Размер<input value={fields.size} onChange={(event) => setField('size', event.target.value)} placeholder="Например, 17.5" /></label>
              <label>Номер заказа<input value={fields.order_number} onChange={(event) => setField('order_number', event.target.value)} placeholder="Если есть" /></label>
            </div>
            <div className="form-section-label">Материалы и покрытие</div>
            <div className="form-grid">
              <label>Материал основы<input value={fields.base_material} onChange={(event) => setField('base_material', event.target.value)} placeholder="Например, серебро 925" /></label>
              <label>Материал тела<input value={fields.body_material} onChange={(event) => setField('body_material', event.target.value)} placeholder="Уточните материал" /></label>
              <label>Материал дополнительный<input value={fields.additional_material} onChange={(event) => setField('additional_material', event.target.value)} placeholder="При наличии" /></label>
              <label>Покрытие<select value={fields.coating} onChange={(event) => setField('coating', event.target.value)}><option value="">Не указано</option>{COATINGS.map((item) => <option key={item}>{item}</option>)}</select></label>
              <label className="field-full">Прочие материалы<textarea value={fields.other_materials} onChange={(event) => setField('other_materials', event.target.value)} placeholder="Камни, цвет, цвет эмали и другие детали" rows={2} /></label>
              <label className="field-full">Примечание<textarea value={fields.note} onChange={(event) => setField('note', event.target.value)} placeholder="Дополнительная информация для оператора" rows={2} /></label>
            </div>
            <div className="form-section-label">{fields.is_custom === 'true' ? 'Изображение · обязательно для кастома' : 'Изображение'}</div>
            <label className={`upload-zone ${fields.is_custom === 'true' && !image && !selectedRequest?.image_url ? 'upload-required' : ''}`}>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { setImage(event.target.files?.[0] ?? null); setRemoveImage(false) }} />
              <span className="upload-icon">↥</span><span><b>{image?.name ?? (selectedRequest?.image_url && !removeImage ? 'Изображение уже загружено' : 'Нажмите, чтобы выбрать файл')}</b><small>JPG, PNG или WebP · до 10 МБ {fields.is_custom === 'true' ? '· обязательно' : ''}</small></span>
              {selectedRequest?.image_url && !image && <button type="button" className="text-button remove-image" onClick={(event) => { event.preventDefault(); setRemoveImage(true) }}>{removeImage ? 'Удалено' : 'Убрать'}</button>}
            </label>
            {modal === 'edit' && user.role === 'admin' && <><div className="form-section-label">Результат обработки</div><div className="form-grid"><label>Дата создания<input type="date" value={fields.creation_date} onChange={(event) => setField('creation_date', event.target.value)} /></label><label>Номенклатура<input value={fields.nomenclature} onChange={(event) => setField('nomenclature', event.target.value)} placeholder="Заполняет оператор" /></label></div></>}
            {error && <div className="form-error"><span>{error}</span>{duplicateRequestId !== null && requests.some((request) => request.id === duplicateRequestId) && <button type="button" className="text-button duplicate-link" onClick={openDuplicateRequest}>Открыть заявку №{duplicateRequestId}</button>}</div>}
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Отмена</button><button className="button button-primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить заявку'} <span>→</span></button></div>
          </form> : modal === 'complete' ? <form onSubmit={saveCompletion} className="modal-form compact-form">
            <div className="request-summary"><span className="request-symbol">{selectedRequest?.item_type.slice(0, 1)}</span><div><b>{selectedRequest?.model}</b><small>{selectedRequest?.item_type} · заявка №{selectedRequest?.id}</small></div></div>
            <label>Дата создания<input type="date" value={fields.creation_date} onChange={(event) => setField('creation_date', event.target.value)} required /></label>
            <label>Номенклатура<input value={fields.nomenclature} onChange={(event) => setField('nomenclature', event.target.value)} placeholder="Введите артикул" required /></label>
            <p className="form-hint">После сохранения заявка будет отмечена как выполненная.</p>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Отмена</button><button className="button button-primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'} <span>→</span></button></div>
          </form> : <form onSubmit={saveUser} className="modal-form compact-form">
            <label>Логин<input value={userForm.username} onChange={(event) => setUserForm((current) => ({ ...current, username: event.target.value }))} autoComplete="off" required /></label>
            <label>Роль<select value={userForm.role} onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value as Role }))}><option value="manager">Менеджер</option><option value="operator">Оператор</option><option value="admin">Администратор</option></select></label>
            <label>Пароль<input type="password" value={userForm.password} onChange={(event) => setUserForm((current) => ({ ...current, password: event.target.value }))} placeholder={editingUser ? 'Оставьте пустым, чтобы не менять' : 'Не менее 8 символов'} minLength={editingUser ? undefined : 8} required={!editingUser} autoComplete="new-password" /></label>
            {error && <div className="form-error">{error}</div>}
            <div className="modal-actions"><button type="button" className="button button-quiet" onClick={() => setModal(null)}>Отмена</button><button className="button button-primary" disabled={busy}>{busy ? 'Сохранение…' : 'Сохранить'} <span>→</span></button></div>
          </form>}
        </section>
      </div>}
    </div>
  )
}

export default App
