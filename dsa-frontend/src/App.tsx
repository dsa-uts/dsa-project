import { BrowserRouter, Navigate, Route, Routes } from 'react-router'
import LoginPage from './pages/LoginPage'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import ProtectedRoute from './ProtectedRoute';
import DashBoardPage from './pages/DashBoardPage';
import ProblemStatementPage from './pages/ProblemStatementPage';
import NotFoundPage from './pages/NotFound';
import ValidationResultsListing from './pages/ValidationResultsListing';
import ValidationDetail from './pages/ValidationDetail';
import BatchValidation from './pages/BatchValidation';
import NavigationBarLayout from './NavigationBarLayout';
import AdminRoute from './AdminRoute';
import BatchedUserCreation from './pages/admin/BatchedUserCreation';
import UserList from './pages/admin/UserList';
import About from './pages/About';
import AdminPage from './pages/admin/AdminPage';
import ProblemRegistration from './pages/admin/ProblemRegistration';
import GradingRoute from './GradingRoute';
import GradingUpload from './pages/grading/GradingUpload';
import GradingMenu from './pages/grading/GradingMenu';

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<ProtectedRoute> <NavigationBarLayout /> </ProtectedRoute>}>
            <Route path="/about" element={<About />} />
            <Route path="/dashboard" element={<DashBoardPage />} />
            <Route path="/problem/:lectureid/:problemid" element={<ProblemStatementPage />} />
            <Route path="/validation/results" element={<ValidationResultsListing />} />
            <Route path="/validation/detail/:idParam" element={<ValidationDetail />} />
            <Route path="/validation/batch" element={<BatchValidation />} />
          </Route>
          <Route path="admin" element={<AdminRoute><NavigationBarLayout /></AdminRoute>}>
            <Route path="list" element={<AdminPage />} />
            <Route path="user/register/batch" element={<BatchedUserCreation />} />
            <Route path="user/list" element={<UserList />} />
            <Route path="problem/register" element={<ProblemRegistration />} />
          </Route>
          <Route path="grading" element={<GradingRoute><NavigationBarLayout /></GradingRoute>}>
            <Route path="list" element={<GradingMenu />} />
            <Route path="upload" element={<GradingUpload />} />
          </Route>
          <Route path="/" element={<Navigate to="/login" />} />
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  )
}

export default App
