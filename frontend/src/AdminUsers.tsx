import { useState, type ReactNode, type SubmitEventHandler } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { $api, fetchClient } from '@/api/client'
import type { components } from '@/api/schema'
import { useAuth } from '@/auth'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'

type User = components['schemas']['UserAccount']
type Role = components['schemas']['AssignableUserRole']
type Update = components['schemas']['UpdateUserAccountRequest']
type Fields = { userid: string; name: string; role: Role; password: string; confirmation: string }
type FieldErrors = Partial<Record<keyof Fields, string>>
const inputClass = 'h-10 rounded-md border bg-background px-3 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'

function validate(fields: Fields, editing: boolean): FieldErrors {
  const errors: FieldErrors = {}
  if (!editing && fields.userid.match(/^[A-Za-z0-9][A-Za-z0-9._-]{0,29}$/)?.[0] !== fields.userid) errors.userid = 'Use 1–30 letters, digits, dots, underscores or hyphens, starting with a letter or digit.'
  if ([...fields.name].length < 1 || [...fields.name].length > 64 || /\p{Cc}/u.test(fields.name) || !/[^\p{Z}]/u.test(fields.name)) errors.name = 'Use 1–64 characters, with no control characters or whitespace-only name.'
  if (!editing || fields.password !== '' || fields.confirmation !== '') {
    if ([...fields.password].length < 8 || [...fields.password].length > 256) errors.password = 'Use 8–256 characters.'
    if (fields.password !== fields.confirmation) errors.confirmation = 'Passwords do not match.'
  }
  return errors
}

function Field({ name, label, error, children }: { name: string; label: string; error?: string; children: ReactNode }) {
  return <div className="flex flex-col gap-1 text-sm">
    <label htmlFor={name}>{label}</label>
    {children}
    {error && <p id={`${name}-error`} className="text-destructive">{error}</p>}
  </div>
}

function UserDialog({ user, onClose, onSaved }: { user: User | null; onClose: () => void; onSaved: (message: string) => Promise<void> }) {
  const [fields, setFields] = useState<Fields>({ userid: user?.userid ?? '', name: user?.name ?? '', role: user?.role === 'manager' ? 'manager' : 'student', password: '', confirmation: '' })
  const [errors, setErrors] = useState<FieldErrors>({})
  const [apiError, setApiError] = useState('')
  const [busy, setBusy] = useState(false)
  const submit: SubmitEventHandler = async (event) => {
    event.preventDefault()
    const nextErrors = validate(fields, user !== null)
    setErrors(nextErrors)
    if (Object.keys(nextErrors).length) return
    setBusy(true)
    try {
      const result = user
        ? await fetchClient.PATCH('/api/admin/users/{user_id}', { params: { path: { user_id: user.id } }, body: { name: fields.name, ...(user.role !== 'admin' ? { role: fields.role } : {}), ...(fields.password !== '' ? { password: fields.password } : {}) } })
        : await fetchClient.POST('/api/admin/users', { body: { userid: fields.userid, name: fields.name, role: fields.role, password: fields.password } })
      if (result.error) {
        if (result.error.error.code === 'userid_taken') setErrors({ userid: 'This User ID is already taken.' })
        else setApiError(result.error.error.message)
        return
      }
      await onSaved(user ? 'User Account updated.' : 'User Account created.')
      onClose()
    } catch { setApiError('Unable to save. Please try again.') }
    finally { setBusy(false) }
  }
  return <Dialog title={user ? 'Edit User Account' : 'Create User Account'} description={user ? 'User ID is immutable. Leave both password fields empty to keep the password. Resetting a password ends all sessions.' : 'Supply an initial password for this User Account.'} onClose={onClose} busy={busy}>
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {(['userid', 'name', 'password', 'confirmation'] as const).map((name) => <Field key={name} name={name} label={{ userid: 'User ID', name: 'Display name', password: 'Password', confirmation: 'Confirm password' }[name]} error={errors[name]}>
        <input id={name} className={inputClass} type={name === 'password' || name === 'confirmation' ? 'password' : 'text'} autoComplete={name === 'password' || name === 'confirmation' ? 'new-password' : 'off'} value={fields[name]} disabled={busy || (name === 'userid' && user !== null)} aria-invalid={!!errors[name]} aria-describedby={errors[name] ? `${name}-error` : undefined} onChange={(event) => setFields({ ...fields, [name]: event.target.value })} />
      </Field>)}
      {user?.role === 'admin' ? <p className="text-sm">Role: Admin</p> : <Field name="role" label="Role">
        <select id="role" className={inputClass} value={fields.role} disabled={busy} onChange={(event) => {
          const role = event.target.value
          if (role === 'student' || role === 'manager') setFields({ ...fields, role })
        }}>
          <option value="student">Student</option><option value="manager">Manager</option>
        </select>
      </Field>}
      {apiError && <p role="alert" className="text-sm text-destructive">{apiError}</p>}
      <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={busy} onClick={onClose}>Cancel</Button><Button type="submit" disabled={busy}>{busy ? 'Saving…' : user ? 'Save' : 'Create'}</Button></div>
    </form>
  </Dialog>
}

function UsersScreen() {
  const queryClient = useQueryClient()
  const users = $api.useQuery('get', '/api/admin/users', {}, { retry: false })
  const [search, setSearch] = useState('')
  const [state, setState] = useState('all')
  const [editing, setEditing] = useState<{ user: User | null } | null>(null)
  const [disabling, setDisabling] = useState<User | null>(null)
  const [notification, setNotification] = useState('')
  const [mutationError, setMutationError] = useState('')
  const [busy, setBusy] = useState(false)
  const saved = async (message: string) => {
    await queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/api/admin/users').queryKey })
    setNotification(message)
    await queryClient.invalidateQueries({ queryKey: $api.queryOptions('get', '/api/me').queryKey })
  }
  const changeState = async (user: User, body: Update) => {
    setBusy(true)
    try {
      const result = await fetchClient.PATCH('/api/admin/users/{user_id}', { params: { path: { user_id: user.id } }, body })
      if (result.error) { setMutationError(result.error.error.message); return }
      await saved(body.disabled ? 'User Account disabled. All sessions ended.' : 'User Account re-enabled.')
      setMutationError('')
      setDisabling(null)
    } catch { setMutationError('Unable to update. Please try again.') }
    finally { setBusy(false) }
  }
  const query = search.trim().toLowerCase()
  const visible = users.data?.users.filter((user) => (state === 'all' || user.disabled === (state === 'disabled')) && (user.userid.toLowerCase().includes(query) || user.name.toLowerCase().includes(query))) ?? []
  return <main className="flex-1 bg-background p-6 text-foreground">
    <div className="mx-auto flex max-w-5xl flex-col gap-5">
      <Link to="/" className="underline">Home</Link>
      <div className="flex items-center justify-between gap-4"><h1 className="text-2xl font-semibold">User Accounts</h1><Button onClick={() => setEditing({ user: null })}>Create user</Button></div>
      {notification && <p role="status" className="text-success">{notification}</p>}
      {mutationError && !disabling && <p role="alert" className="text-destructive">{mutationError}</p>}
      <div className="flex flex-wrap gap-4">
        <Field name="search" label="Search users"><input id="search" className={inputClass} value={search} onChange={(event) => setSearch(event.target.value)} /></Field>
        <Field name="state" label="State"><select id="state" className={inputClass} value={state} onChange={(event) => setState(event.target.value)}><option value="all">All</option><option value="active">Active</option><option value="disabled">Disabled</option></select></Field>
      </div>
      {users.isPending ? <p>Loading…</p> : users.isError ? <div role="alert"><p className="text-destructive">Unable to load User Accounts.</p><Button variant="outline" onClick={() => void users.refetch()}>Retry</Button></div> : <div className="overflow-x-auto rounded-lg border"><table className="w-full text-left text-sm">
        <thead className="bg-muted"><tr>{['User ID', 'Display name', 'Role', 'State', 'Actions'].map((title) => <th key={title} className="p-3">{title}</th>)}</tr></thead>
        <tbody>{visible.map((user) => <tr key={user.id} className="border-t">
          <td className="p-3">{user.userid}</td><td className="p-3">{user.name}</td><td className="p-3">{user.role}</td><td className="p-3">{user.disabled ? 'Disabled' : 'Active'}</td>
          <td className="flex gap-2 p-3"><Button variant="outline" disabled={busy} onClick={() => setEditing({ user })}>Edit</Button><Button variant="outline" disabled={busy} onClick={() => {
            setMutationError('')
            if (user.disabled) void changeState(user, { disabled: false })
            else setDisabling(user)
          }}>{user.disabled ? 'Re-enable' : 'Disable account'}</Button></td>
        </tr>)}</tbody>
      </table>{visible.length === 0 && <p className="p-3 text-muted-foreground">No matching User Accounts.</p>}</div>}
      {editing && <UserDialog user={editing.user} onClose={() => setEditing(null)} onSaved={saved} />}
      {disabling && <Dialog title="Disable User Account" description={`Disable ${disabling.userid} (${disabling.name})? This ends all their sessions and prevents login. Their history is retained.`} onClose={() => setDisabling(null)} busy={busy}>
        {mutationError && <p role="alert" className="text-destructive">{mutationError}</p>}
        <div className="flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setDisabling(null)}>Cancel</Button><Button variant="destructive" disabled={busy} onClick={() => void changeState(disabling, { disabled: true })}>Disable account</Button></div>
      </Dialog>}
    </div>
  </main>
}

export function AdminUsersPage() {
  const { user } = useAuth()
  if (user?.role !== 'admin') return <main className="p-6"><h1 className="text-2xl font-semibold">403 Forbidden</h1><Link to="/" className="underline">Home</Link></main>
  return <UsersScreen />
}
