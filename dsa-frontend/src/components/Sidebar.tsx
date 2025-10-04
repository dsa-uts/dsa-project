import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import styled from 'styled-components';
import { Lecture } from '../types/Assignments';
import { fetchLectures } from '../api/GetAPI';
import { useAuth } from '../context/AuthContext';
import useApiClient from '../hooks/useApiClient';
import { UserRole } from '../types/token';

const Sidebar: React.FC = () => {
	const { token, user_id, role, logout } = useAuth();
	const [lectures, setLectures] = useState<Lecture[]>([]);
	// どの授業の課題が展開されているかを管理する状態変数
	const [expandedLectures, setExpandedLectures] = useState<{ [key: number]: boolean }>({});

	const { apiClient } = useApiClient();
	const isAdminOrManager = role === UserRole.admin || role === UserRole.manager;

	useEffect(() => {
		const fetchLecturesGrantedByUser = async () => {
			try {
				const all_lectures = await apiClient({apiFunc: fetchLectures, args: [isAdminOrManager]})
				setLectures(all_lectures);
			} catch (error) {
				console.error('Failed to fetch lectures:', error);
			}
		}	
		fetchLecturesGrantedByUser();
	}, [token]);

	const toggleLecture = (lectureId: number) => {
		setExpandedLectures(prev => (
			{ ...prev, [lectureId]: !prev[lectureId] }
		)
		);
	};

	return (
		<SidebarContainer>
			<SidebarList>
				<Link to="/status/me"><h3>{user_id}</h3></Link>
				<Link to="/status/all"><h3>全ての提出</h3></Link>
				<Link to="/"><h3>ホーム</h3></Link>
				{lectures.map(
					lecture => (
						<SidebarItem key={lecture.id}>
							<h3 onClick={() => toggleLecture(lecture.id)}>
								{expandedLectures[lecture.id] ? '▼' : '▶'} {lecture.title}
							</h3>
							{expandedLectures[lecture.id] && (
								<ProblemList>
									{lecture.problems.map(problem => (
										<ProblemItem key={problem.assignment_id}>
											<Link to={`/submission/${problem.lecture_id}/${problem.assignment_id}`}>
												{problem.title}
											</Link>
										</ProblemItem>
									))}
									<ProblemItem>
										<Link to={`/format-check?lecture_id=${lecture.id}`}>フォーマットチェック</Link>
									</ProblemItem>
								</ProblemList>
							)}
						</SidebarItem>
					)
				)}
			</SidebarList>

			{/*!isAdminOrManager &&
				<div>
					<Link to="/users/passChange"><h3>パスワード変更</h3></Link>
				</div>
			*/}
			
			{isAdminOrManager &&
				<div>
					<Link to="/problem/update"><h3>課題追加</h3></Link>
					<Link to="/batch/submit"><h3>採点</h3></Link>
					<Link to="/batch/status"><h3>採点履歴</h3></Link>
					<Link to="/users/management"><h3>ユーザー管理</h3></Link>
				</div>
			}
			{token && <LogoutButton onClick={logout}>ログアウト</LogoutButton>}
		</SidebarContainer>
	);
}

export default Sidebar;


const ProblemList = styled.ul`
	list-style-type: none;
	padding-left: 20px;
`;

const ProblemItem = styled.li`
  margin: 5px 0;
	a {
		&:hover {
			text-decoration: underline;
		}
	}
`;


const SidebarContainer = styled.div`
	display: flex;
	flex-direction: column;
	justify-content: space-between;
	padding: 20px 20px 0 30px;
	width: 230px;
	height: 100vh;
	background-color: dimgray;
	position: fixed;
	overflow-y: auto;
`;

const SidebarList = styled.ul`
	list-style-type: none;
	padding: 0;
`;

const SidebarItem = styled.li`
	h3 {
		margin: 10px 0;
		&:hover {
		background-color: #555;
		color: white;
		cursor: pointer;
		padding: 0px 20px 0 30px;
		margin: 0 -20px 0 -30px;
		}
	}
	a, a:visited {
		color: inherit;
		text-decoration: none;
	}
`;

const LogoutButton = styled.h4`
	margin: 0px 0px 50px 0px;
	background-color: transparent;
	color: inherit;
	border: none;
	text-align: left;
	width: 100%;
	cursor: pointer;

	&:hover {
		background-color: #555;
		color: white;
	}
`;