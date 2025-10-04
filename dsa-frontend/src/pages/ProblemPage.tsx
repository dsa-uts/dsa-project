import { useParams, useNavigate } from 'react-router-dom';
import React, { useEffect, useState } from 'react';
import { Problem } from '../types/Assignments';
import { fetchProblemDetail } from '../api/GetAPI';
import FileUploadBox from '../components/FileUploadBox';
import useApiClient from '../hooks/useApiClient';
import { submitAssignment } from '../api/PostAPI';
import { useAuth } from '../context/AuthContext';
import MarkdownRenderer from '../components/MarkdownRenderer';
import { UserRole } from '../types/token';

const SubmissionPage: React.FC = () => {
	const { token, user_id, role } = useAuth();
	let { lectureId, assignmentId } = useParams<{ lectureId: string; assignmentId: string }>();
	const [problem, setProblem] = useState<Problem | null>(null);
	const { apiClient } = useApiClient();
	const [hasError, setHasError] = useState<boolean>(false);
	const navigate = useNavigate();
	const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

	const isAdminOrManager = role === UserRole.admin || role === UserRole.manager;

	const evaluation = isAdminOrManager;

	useEffect(() => {
		const fetchData = async () => {
			try {
				if (lectureId && assignmentId) {
					const problem_with_detail = await apiClient({ apiFunc: fetchProblemDetail, args: [parseInt(lectureId), parseInt(assignmentId), evaluation] });
					setProblem(problem_with_detail);
				} else {
					setHasError(true);
					console.error('データの取得に失敗しました．リロードしても失敗する場合はTAに連絡してください．');
				}
			} catch (error) {
				setHasError(true);
				console.error('データの取得に失敗しました．リロードしても失敗する場合はTAに連絡してください．', error);
			}
		};
		fetchData();
	}, [lectureId, assignmentId, token]);

	const handleSubmit = async (files: File[]) => {
		if (isSubmitting) {
			return;
		}
		setIsSubmitting(true);

		if (lectureId && assignmentId) {
			// 必要なファイルが全てアップロードされているか確認
			const uploadedFileNames = files.map(file => file.name);
			const missingFiles = problem?.detail?.required_files.filter(file => !uploadedFileNames.includes(file.name)) || [];

			if (missingFiles.length > 0) {
				console.error('以下のファイルがアップロードされていません：', missingFiles.map(f => f.name).join(', '));
				alert(`以下のファイルがアップロードされていません：${missingFiles.map(f => f.name).join(', ')}`);
				setIsSubmitting(false);
				return;
			}

			try {
				const submissionRecord = await apiClient({ apiFunc: submitAssignment, args: [parseInt(lectureId), parseInt(assignmentId), evaluation, files] });
				navigate('/status/me');
			} catch (error) {
				console.error('提出エラー: ', error);
			} finally {
				setIsSubmitting(false);
			}
		}
		setIsSubmitting(false);
	};

	if (hasError) {
		return <>
			<h1>Not Found</h1>
			<div>指定された課題は存在しないか，未公開です．</div>
		</>;
	}

	return (
		<div style={{ paddingBottom: '100px' }}>
			<div>
				{problem && problem.detail && problem.detail.description && <MarkdownRenderer content={problem.detail.description} />}
			</div>
			<div>
				{problem && (
					<>
					  <h1>制限</h1>
						<p>実行時間: {problem.timeMS}ms</p>
						<p>メモリ: {problem.memoryMB}MB</p>
					</>
				)}
				<h1>必要なファイル</h1>
				<ul>
					{problem && problem.detail && (
						problem.detail.required_files.map((file, index) => (
							<li key={index}>{file.name}</li>
						))
					)}
				</ul>
			</div>
			<div>
				<h1>提出フォーム</h1>
				<FileUploadBox onSubmit={handleSubmit} descriptionOnBox={'zipではなく各ファイルを提出してください．'} isSubmitting={isSubmitting} />
			</div>
		</div>
	);
};

export default SubmissionPage;
