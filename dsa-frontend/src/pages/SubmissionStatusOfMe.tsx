import React, { useEffect, useState } from 'react';
import { fetchSubmissionList, fetchSubmissionStatus, fetchProblemEntry, fetchLectures, fetchMyUserInfo } from '../api/GetAPI';
import { Submission, Problem, Lecture } from '../types/Assignments'
import { Link } from 'react-router-dom';
import useApiClient from '../hooks/useApiClient';
import { useAuth } from '../context/AuthContext';
import { UserRole } from '../types/token';
import { User } from '../types/user';
import { SubmissionStatusQuery } from '../types/Assignments';
import {
  Table, TableBody, TableCell, TableContainer, TableHead, 
  TableRow, Paper, FormControl, InputLabel, Select, MenuItem,
  Button, Box, Typography, SelectChangeEvent
} from '@mui/material';
import TableSortLabel from '@mui/material/TableSortLabel';
import { styled } from '@mui/material/styles';
import StatusButton from '../components/StatusButtonComponent';

const LoadingDots = styled('span')({
  '&::after': {
    content: '".."',
    animation: 'dots 1.5s steps(3, end) infinite',
  },
  '@keyframes dots': {
    '0%': { content: '"."' },
    '33%': { content: '".."' },
    '66%': { content: '"..."' },
  }
});

const SearchContainer = styled('div')({
  display: 'flex',
  gap: '16px',
  marginBottom: '24px',
  width: '100%'
});

const SearchField = styled('div')({
  display: 'flex',
  alignItems: 'center',
  flex: 1, // 利用可能な空間を均等に分配
  minWidth: '200px'
});

const SearchButton = styled('div')({
  display: 'flex',
  alignItems: 'center'
});

const SubmissionStatusOfMe: React.FC = () => {
  const { token, role } = useAuth();
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [page, setPage] = useState<number>(1);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const { apiClient } = useApiClient();

  const [id2problem, setId2Problem] = useState<{[key: string]: Problem}>({});
  const [lectureId2Lecture, setLectureId2Lecture] = useState<{[key: number]: Lecture}>({});
  const [myself, setMyself] = useState<User | null>(null);
  const [lectureId, setLectureId] = useState<number | null>(null);
  const [assignmentId, setAssignmentId] = useState<number | null>(null);
  const [resultQuery, setResultQuery] = useState<SubmissionStatusQuery | null>(null);
  const [tsOrder, setTsOrder] = useState<"asc" | "desc">("desc");
  const [selectedProblem, setSelectedProblem] = useState<string>('');

  const isAdminOrManager = role === UserRole.admin || role === UserRole.manager;

  const all = false;

  useEffect(() => {
    const fetchSubmissions = async () => {
      try {
        // setLoading(true);
        const data = await apiClient({ apiFunc: fetchSubmissionList, args: [page, all, null, tsOrder, lectureId, assignmentId, resultQuery] });
        setSubmissions(data);

        const dict: {[key: string]: Problem} = {};
        const lectures = await apiClient({ apiFunc: fetchLectures, args: [isAdminOrManager] });
        lectures.forEach((lecture) => {
          lecture.problems.forEach((problem) => {
            dict[`${problem.lecture_id}-${problem.assignment_id}`] = problem;
          });
        });
        setId2Problem(dict);
        const lectureDict: {[key: number]: Lecture} = {};
        lectures.forEach((lecture) => {
          lectureDict[lecture.id] = lecture;
        });
        setLectureId2Lecture(lectureDict);
        setError(null);
      } catch (err) {
        setError('提出状況の取得に失敗しました．リロードしても失敗する場合はTAに連絡してください．');
      } finally {
        setLoading(false);
      }
    };
    fetchSubmissions();
  }, [tsOrder, token]);

  useEffect(() => {
    const fetchMyself = async () => {
      const data = await apiClient({ apiFunc: fetchMyUserInfo, args: [] });
      setMyself(data);
    }
    fetchMyself();
  }, [token]);

  useEffect(() => {
    const interval = setInterval(async () => {
      const updateSubmissions = await Promise.all(
        submissions.map(async (submission) => {
          if (submission.progress !== "done") {
            try {
              return await apiClient({ apiFunc: fetchSubmissionStatus, args: [submission.id] });
            } catch (err) {
              console.error('提出状況の取得に失敗しました．リロードしても失敗する場合はTAに連絡してください．', err);
              return submission;
            }
          } else {
            return submission;
          }
        })
      );
      setSubmissions(updateSubmissions);
    }, 2000);

    // クリーンアップ関数
    return () => clearInterval(interval);
  }, [submissions, token]);

  useEffect(() => {
    handleSearch();
  }, [page]);

  const handleSearchButton = () => {
    setPage(1);
    handleSearch();
  };

  const handlePrevPageButton = () => {
    setPage(page - 1 < 1 ? 1 : page - 1);
  };

  const handleNextPageButton = () => {
    setPage(page + 1);
  };

  const handleSearch = async () => {
    // setLoading(true);
    const data = await apiClient({ apiFunc: fetchSubmissionList, args: [page, all, null, tsOrder, lectureId, assignmentId, resultQuery] });
    setSubmissions(data);
    setLoading(false);
  };

  const handleProblemChange = (event: SelectChangeEvent) => {
    if (event.target.value === '') {
      setLectureId(null);
      setAssignmentId(null);
    } else {
      const [lecId, assId] = event.target.value.split('-');
      setLectureId(Number(lecId));
      setAssignmentId(Number(assId));
    }
    setSelectedProblem(event.target.value);
  };

  const handleSortClick = () => {
    setTsOrder(tsOrder === "asc" ? "desc" : "asc");
  };

  if (loading) return <div>読み込み中...</div>
  if (error) return <div>{error}</div>

  return (
    <Paper sx={{ p: 3, margin: 2}}>
      <Typography variant="h4" gutterBottom>自分の提出</Typography>

      {/* 注意書き */}
      <Box sx={{ mb: 3 }}>
        <Typography color="warning.main">
          注) ここで行った提出で、課題の評価はされません。
        </Typography>
        <Typography color="warning.main">
          注) 問題無く採点可能であることを確認した後、manabaでソースコードとレポートPDFを提出してください。
        </Typography>
      </Box>

      {/* ページネーション */}
      <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 2}}>
        <Button
          onClick={handlePrevPageButton}
          disabled={page === 1}
        >
          Prev
        </Button>
        <Typography sx={{ mx: 2, lineHeight: '40px' }}>{page}</Typography>
        <Button
          onClick={handleNextPageButton}
          disabled={submissions.length < 10}
        >
          Next
        </Button>
      </Box>

      {/* 検索フォーム */}
      <SearchContainer>
        <SearchField>
          <FormControl fullWidth>
            <InputLabel>課題</InputLabel>
            <Select
              value={selectedProblem}
              label="課題"
              onChange={handleProblemChange}
            >
              <MenuItem value="">全て</MenuItem>
              {Object.entries(id2problem).map(([key, problem]) => (
                <MenuItem key={key} value={key}>
                  {lectureId2Lecture[problem.lecture_id].title} - {problem.title}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        </SearchField>
        <SearchField>
          <FormControl fullWidth>
            <InputLabel>結果</InputLabel>
            <Select
              value={resultQuery || ''}
              label="結果"
              onChange={(e) => setResultQuery(e.target.value === 'all' ? null : e.target.value as SubmissionStatusQuery)}
            >
              <MenuItem value="all">全て</MenuItem>
              <MenuItem value="AC">AC</MenuItem>
              <MenuItem value="WA">WA</MenuItem>
              <MenuItem value="TLE">TLE</MenuItem>
              <MenuItem value="MLE">MLE</MenuItem>
              <MenuItem value="RE">RE</MenuItem>
              <MenuItem value="CE">CE</MenuItem>
              <MenuItem value="OLE">OLE</MenuItem>
              <MenuItem value="IE">IE</MenuItem>
              <MenuItem value="FN">FN</MenuItem>
              <MenuItem value="WJ">WJ</MenuItem>
            </Select>
          </FormControl>
        </SearchField>
        <SearchButton>
          <Button
            variant="contained"
            onClick={handleSearchButton}
            sx={{ height: '100%' }}
          >
            検索
          </Button>
        </SearchButton>
      </SearchContainer>

      {/* テーブル */}
      <TableContainer component={Paper}>
        <Table>
          <TableHead>
            <TableRow>
              <TableCell>
                <TableSortLabel
                  active={true}
                  direction={tsOrder}
                  onClick={handleSortClick}
                >
                  提出日時
                </TableSortLabel>
              </TableCell>
              <TableCell>課題</TableCell>
              <TableCell>ユーザ</TableCell>
              <TableCell>結果</TableCell>
              <TableCell>実行時間</TableCell>
              <TableCell>メモリ</TableCell>
              <TableCell>{/* 詳細 */}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {submissions.map((submission) => (
              <TableRow key={submission.id}>
                <TableCell>{new Date(submission.ts).toLocaleString()}</TableCell>
                <TableCell>
                  <Link to={`/submission/${submission.lecture_id}/${submission.assignment_id}`}>
                    {lectureId2Lecture[submission.lecture_id]?.title} - {id2problem[`${submission.lecture_id}-${submission.assignment_id}`]?.title}
                  </Link>
                </TableCell>
                <TableCell>{`${myself?.username} (${myself?.user_id})`}</TableCell>
                <TableCell>{submission.result ? <StatusButton status={submission.result} /> : "-"}</TableCell>
                <TableCell>{submission.timeMS}ms</TableCell>
                <TableCell>{submission.memoryKB}KB</TableCell>
                <TableCell>
                  {submission.progress === "done" ? (
                    <Link to={`/result/${submission.id}`}>詳細</Link>
                  ): (
                    <span>
                      {submission.completed_task}/{submission.total_task}
                      <LoadingDots />
                    </span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </TableContainer>
    </Paper>
  );
};

export default SubmissionStatusOfMe;
