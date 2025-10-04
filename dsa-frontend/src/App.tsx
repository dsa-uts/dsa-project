import React from 'react';
import { Route, Routes, Navigate, useLocation } from 'react-router-dom';
import Home from './pages/Home';
import Sidebar from './components/Sidebar';
import SubmissionPage from './pages/ProblemPage';
import RegisterPage from './pages/UserRegisterationPage';
import LoginPage from './pages/LoginPage';
import SubmissionStatusOfMe from './pages/SubmissionStatusOfMe';
import { useAuth } from './context/AuthContext';
import SubmissionDetail from './pages/SubmissionDetail';
import FormatCheckSubmission from './pages/FormatCheckSubmission';
import BatchSubmission from './pages/BatchSubmission';
import BatchDetailPage from './pages/BatchDetailPage';
import BatchUserDetailPage, { BatchUserDetailState } from './pages/BatchUserDetailPage';
import StudentPassChangePage from './pages/StudentPassChangePage';
import UserManagementPage from './pages/UserManagementPage';
import UserArrangePage from './pages/UserArrangePage';
import BatchStatusPage from './pages/BatchStatusPage';
import ProblemUpdatePage from './pages/ProblemUpdatePage';
import SubmissionStatusAll from './pages/SubmissionStatusAll';

// ログインしているユーザーのみがアクセスできるページを作成するためのコンポーネント
// ログインしていないユーザーはログインページにリダイレクトされる
const PrivateRoute: React.FC<{ element: React.ReactElement }> = ({ element }) => {
		const { token } = useAuth();
		return token ? element : <Navigate to="/login" replace />;
};

// アプリケーションのルートコンポーネント
const App: React.FC = () => {
	const { token } = useAuth();
	const location = useLocation();
	const state = location.state as BatchUserDetailState;

    return (
			
			<div className="app">
				{token && <Sidebar />}
				<div className="content">
				<Routes>
					<Route path="/login" element={<LoginPage />} />
					<Route path="/users/register" element={<PrivateRoute element={<RegisterPage />} />} />
					<Route path="/" element={<PrivateRoute element={<Home />} />} />
					<Route path="/submission/:lectureId/:assignmentId" element={<PrivateRoute element={<SubmissionPage />} />} />
					<Route path="/status/me" element={<PrivateRoute element={<SubmissionStatusOfMe />} />} />
					<Route path="/status/all" element={<PrivateRoute element={<SubmissionStatusAll />} />} />
					<Route path="/result/:submissionId" element={<PrivateRoute element={<SubmissionDetail />} />} />
					<Route path="/users/passChange" element={<PrivateRoute element={<StudentPassChangePage />} />} />
					<Route path="/format-check" element={<PrivateRoute element={<FormatCheckSubmission />} />} />
					<Route path="/batch/submit" element={<PrivateRoute element={<BatchSubmission />} />} />
					<Route path="/batch/status" element={<PrivateRoute element={<BatchStatusPage />} />} />
					<Route path="/batch/result/:batchId" element={<PrivateRoute element={<BatchDetailPage />} />} />
					<Route path="/batch/result/:batchId/user/:userId" element={<PrivateRoute element={<BatchUserDetailPage openingData={state?.openingData || "ステータス"} />} />} />
					<Route path="/users/management" element={<PrivateRoute element={<UserManagementPage />} />} />
					<Route path="/users/edit/:userId" element={<PrivateRoute element={<UserArrangePage />} />} />
					<Route path="/problem/update" element={<PrivateRoute element={<ProblemUpdatePage />} />} />
					<Route path="*" element={<h1>Not Found</h1>} />
				</Routes>
				</div>
			</div>
	);
};

export default App;
