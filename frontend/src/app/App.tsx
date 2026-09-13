import { Navigate, Route, Routes } from 'react-router-dom'
import { Page } from '@/components/Page'
import { NavigationGuard } from '@/components/navigation-guard'
import { AdminUsersPage } from '@/features/users/AdminUsersPage'
import { BulkUsersPage } from '@/features/users/BulkUsersPage'
import { AuthLayout, ProtectedLayout } from '@/lib/auth'
import { AuthenticatedLayout } from './layouts/AuthenticatedLayout'
import { AboutPage } from './pages/AboutPage'
import { AdminPage } from './pages/AdminPage'
import { LoginPage } from './pages/LoginPage'
import { NotFoundPage } from './pages/NotFoundPage'

function App() {
  return (
    <NavigationGuard><div className="flex min-h-svh flex-col">
      <Routes>
        <Route element={<AuthLayout loadingElement={<Page>Loading...</Page>} />}>
          <Route path="/login" element={<LoginPage />} />

          <Route element={<ProtectedLayout />}>
            <Route element={<AuthenticatedLayout />}>
              <Route path="/" element={<Navigate to="/about" replace />} />
              <Route path="/about" element={<AboutPage />} />
              <Route path="/admin/list" element={<AdminPage />} />
              <Route path="/admin/users" element={<AdminUsersPage />} />
              <Route path="/admin/users/bulk" element={<BulkUsersPage />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Route>
        </Route>
      </Routes>
    </div></NavigationGuard>
  )
}

export default App
