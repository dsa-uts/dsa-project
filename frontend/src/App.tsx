import { Navigate, Route, Routes } from 'react-router'
import { Layout } from '@/components/Layout'
import { HomePage } from '@/pages/home/HomePage'
import { LoginPage } from '@/pages/login/LoginPage'

// Routes だけを持つ (Router は main.tsx の BrowserRouter / テストの MemoryRouter)。
function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<Layout />}>
        <Route path="/" element={<HomePage />} />
        {/* 未定義パスも認証ガードの内側に置く (未認証はログインへ) */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}

export default App
