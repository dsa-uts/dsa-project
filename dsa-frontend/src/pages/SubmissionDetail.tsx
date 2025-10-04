import React, { useState, useEffect } from 'react';
import { useParams } from 'react-router-dom';
import { fetchSubmissionFiles, fetchProblemDetail, fetchLectureEntry, fetchUserInfo } from '../api/GetAPI';
import { FileRecord, TestCases, Lecture } from '../types/Assignments';
import useApiClient from '../hooks/useApiClient';
import CodeBlock from '../components/CodeBlock';
import { fetchSubmissionResultDetail } from '../api/GetAPI';
import { Submission, Problem } from '../types/Assignments';
import JudgeResultsViewer from '../components/JudgeResultsViewer';
import { useAuth } from '../context/AuthContext';
import OfflineFileDownloadButton from '../components/OfflineFileDownloadButton';

import {
    Paper, Typography, Container, Box, Select, MenuItem,
    FormControl, InputLabel, Table, TableBody, TableCell,
    TableContainer, TableHead, TableRow, IconButton,
    Collapse, Chip,
    SelectChangeEvent
} from '@mui/material';
import KeyboardArrowDownIcon from '@mui/icons-material/KeyboardArrowDown';
import KeyboardArrowUpIcon from '@mui/icons-material/KeyboardArrowUp';
import { User } from '../types/user';
import StatusButton from '../components/StatusButtonComponent';

const SubmissionDetail: React.FC = () => {
    const { token } = useAuth();
    const { submissionId } = useParams<{ submissionId: string }>();
    const [lecture, setLecture] = useState<Lecture | null>(null);
    const [ problem, setProblem ] = useState<Problem | null>(null);
    const [uploadedFiles, setUploadedFiles] = useState<FileRecord[]>([]);
    const [arrangedFiles, setArrangedFiles] = useState<FileRecord[]>([]);
    const { apiClient } = useApiClient();
    const [selectedUploadedFile, setSelectedUploadedFile] = useState<string>('');
    const [selectedArrangedFile, setSelectedArrangedFile] = useState<string>('');
    const [submission, setSubmission] = useState<Submission | null>(null);
    const [testCaseId2TestCases, setTestCaseId2TestCases] = useState<Map<number, TestCases>>(new Map());
    const [user, setUser] = useState<User | null>(null);

    const [expandedRows, setExpandedRows] = useState<number[]>([]);

    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchFiles = async () => {
            try {
                const { files: uploadedData, zipBlob: notUsed } = await apiClient({ apiFunc: fetchSubmissionFiles, args: [parseInt(submissionId!), 'uploaded']})
                const { files: arrangedData, zipBlob: notUsed2 } = await apiClient({ apiFunc: fetchSubmissionFiles, args: [parseInt(submissionId!), 'arranged']})
                setUploadedFiles(uploadedData);
                setArrangedFiles(arrangedData);
            } catch (error) {
                setError('Failed to fetch submission detail');
            }
        };

        const fetchSubmission = async () => {
            try {
                const submission = await apiClient({ apiFunc: fetchSubmissionResultDetail, args: [parseInt(submissionId!)] });
                setSubmission(submission);

                const problemInfo = await apiClient({ apiFunc: fetchProblemDetail, args: [submission.lecture_id, submission.assignment_id, submission.eval] });
                setProblem(problemInfo);

                const lectureInfo = await apiClient({ apiFunc: fetchLectureEntry, args: [submission.lecture_id] });
                setLecture(lectureInfo);

                const userInfo = await apiClient({ apiFunc: fetchUserInfo, args: [submission.user_id] });
                setUser(userInfo);

                const newTestCaseMap = new Map(
                    problemInfo.detail?.test_cases.map((testCase) => [testCase.id, testCase])
                );

                setTestCaseId2TestCases(newTestCaseMap);
            } catch (error) {
                setError('Failed to fetch submission detail');
            }
        };

        const fetchData = async () => {
            try {
                setLoading(true);
                fetchFiles();
                fetchSubmission();
            } catch (error) {
                setError('Failed to fetch data');
            } finally {
                setLoading(false);
            }
        }

        fetchData();
    }, [submissionId, token]);

    const handleUploadedFileSelect = (event: SelectChangeEvent) => {
        setSelectedUploadedFile(event.target.value);
    };

    const handleArrangedFileSelect = (event: SelectChangeEvent) => {
        setSelectedArrangedFile(event.target.value);
    };

    const getSelectedUploadedFileContent = () => {
        const file = uploadedFiles.find((file) => file.name === selectedUploadedFile);
        return file?.content as string;
    };

    const getSelectedArrangedFileContent = () => {
        const file = arrangedFiles.find((file) => file.name === selectedArrangedFile);
        return file?.content as string;
    };

    if (loading) return <div>Loading...</div>;
    if (error) return <div>Error: {error}</div>;

    const toggleRow = (id: number) => {
        setExpandedRows(prevExpandedRows =>
            prevExpandedRows.includes(id)
                ? prevExpandedRows.filter(rowId => rowId !== id)
                : [...prevExpandedRows, id]
        );
    };

    return (
        <Container maxWidth="lg">
            <Paper sx={{ p: 3, my: 2}}>
                <Typography variant="h4" gutterBottom>
                    提出 #{submissionId} ({problem?.title || '課題名不明'})
                </Typography>

                <Box sx={{ my: 4 }}>
                    <Typography variant="h5" gutterBottom>提出されたファイル一覧</Typography>
                    <FormControl fullWidth sx={{ mb: 2}}>
                        <InputLabel>ファイルを選択</InputLabel>
                        <Select
                            value={selectedUploadedFile}
                            onChange={handleUploadedFileSelect}
                            label="ファイルを選択"
                        >
                            <MenuItem value="">
                                <em>ファイルを選択</em>
                            </MenuItem>
                            {uploadedFiles.filter(file => typeof file.content === 'string').map(file => (
                                <MenuItem key={file.name} value={file.name}>{file.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <CodeBlock code={getSelectedUploadedFileContent()} fileName={selectedUploadedFile} />

                    {/* Blob形式のファイル一覧 */}
                    {uploadedFiles.some(file => file.content instanceof Blob) && (
                        <Box sx={{ mt: 2}}>
                            <Typography variant="h6" gutterBottom>バイナリファイル</Typography>
                            <Paper variant="outlined" sx={{ p: 2 }}>
                                {uploadedFiles.filter(file => file.content instanceof Blob).map(file => (
                                    <Box key={file.name} sx={{ mb: 1 }}>
                                        <OfflineFileDownloadButton file={file} />
                                    </Box>
                                ))}
                            </Paper>
                        </Box>
                    )}
                </Box>

                <Box sx={{ my: 4 }}>
                    <Typography variant="h5" gutterBottom>用意されたファイル一覧</Typography>
                    <FormControl fullWidth sx={{ mb: 2}}>
                        <InputLabel>ファイルを選択</InputLabel>
                        <Select
                            value={selectedArrangedFile}
                            onChange={handleArrangedFileSelect}
                            label="ファイルを選択"
                        >
                            <MenuItem value="">
                                <em>ファイルを選択</em>
                            </MenuItem>
                            {arrangedFiles.filter(file => typeof file.content === 'string').map(file => (
                                <MenuItem key={file.name} value={file.name}>{file.name}</MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <CodeBlock code={getSelectedArrangedFileContent()} fileName={selectedArrangedFile} />

                    {/* Blob形式のファイル一覧 */}
                    {arrangedFiles.some(file => file.content instanceof Blob) && (
                        <Box sx={{ mt: 2}}>
                            <Typography variant="h6" gutterBottom>バイナリファイル</Typography>
                            <Paper variant="outlined" sx={{ p: 2 }}>
                                {arrangedFiles.filter(file => file.content instanceof Blob).map(file => (
                                    <Box key={file.name} sx={{ mb: 1 }}>
                                        <OfflineFileDownloadButton file={file} />
                                    </Box>
                                ))}
                            </Paper>
                        </Box>
                    )}
                </Box>
                
                {submission && problem && (
                    <Box sx={{ my: 4 }}>
                        <Typography variant="h5" gutterBottom>提出結果</Typography>
                        <TableContainer component={Paper} variant="outlined">
                            <Table>
                                <TableBody>
                                    <TableRow>
                                        <TableCell component="th" sx={{ width: '30%' }}>提出日時</TableCell>
                                        <TableCell>{new Date(submission.ts).toLocaleString()}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" sx={{ width: '30%' }}>問題</TableCell>
                                        <TableCell>{lecture?.title} - {problem.title}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" sx={{ width: '30%' }}>ユーザ</TableCell>
                                        <TableCell>{user?.username} ({submission.user_id})</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" sx={{ width: '30%' }}>結果</TableCell>
                                        <TableCell>{submission.result}</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" sx={{ width: '30%' }}>実行時間</TableCell>
                                        <TableCell>{submission.timeMS}ms</TableCell>
                                    </TableRow>
                                    <TableRow>
                                        <TableCell component="th" sx={{ width: '30%' }}>メモリ</TableCell>
                                        <TableCell>{submission.memoryKB}KB</TableCell>
                                    </TableRow>
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Box>
                )}

                {submission && (
                    <Box sx={{my: 4}}>
                        <Typography variant="h5" gutterBottom>メッセージ</Typography>
                        <Paper variant="outlined" sx={{ p: 2}}>
                            <Typography>{submission.message || 'なし'}</Typography>
                            <Typography color="text.secondary">
                                {'detail: ' + submission.detail || ''}
                            </Typography>
                        </Paper>
                    </Box>
                )}

                {submission && (
                    <Box sx={{ my: 4 }}>
                        <Typography variant="h5" gutterBottom>チェックリスト</Typography>
                        <TableContainer component={Paper} variant="outlined">
                            <Table>
                                <TableHead>
                                    <TableRow>
                                        <TableCell padding="checkbox"/>
                                        <TableCell>チェック項目</TableCell>
                                        <TableCell>結果</TableCell>
                                        <TableCell>実行時間</TableCell>
                                        <TableCell>メモリ</TableCell>
                                    </TableRow>
                                </TableHead>
                                <TableBody>
                                    {submission.judge_results.map((judge_result, index) => (
                                        <React.Fragment key={index}>
                                            <TableRow>
                                                <TableCell padding="checkbox">
                                                    <IconButton
                                                        size="small"
                                                        onClick={() => toggleRow(index)}
                                                    >
                                                        {expandedRows.includes(index) ? 
                                                            <KeyboardArrowUpIcon /> : 
                                                            <KeyboardArrowDownIcon />
                                                        }
                                                    </IconButton>
                                                </TableCell>
                                                <TableCell>{testCaseId2TestCases.get(judge_result.testcase_id)?.description || ''}</TableCell>
                                                <TableCell>
                                                    <StatusButton status={judge_result.result} isButton={true} onClick={() => toggleRow(index)} />
                                                </TableCell>
                                                <TableCell>{judge_result.timeMS}ms</TableCell>
                                                <TableCell>{judge_result.memoryKB}KB</TableCell>
                                            </TableRow>
                                            <TableRow>
                                                <TableCell colSpan={5} sx={{ py: 0 }}>
                                                    <Collapse in={expandedRows.includes(index)}>
                                                        <Box sx={{ p: 2}}>
                                                            <JudgeResultsViewer
                                                                result={judge_result}
                                                                testCase={testCaseId2TestCases.get(judge_result.testcase_id)}
                                                            />
                                                        </Box>
                                                    </Collapse>
                                                </TableCell>
                                            </TableRow>
                                        </React.Fragment>
                                    ))}
                                </TableBody>
                            </Table>
                        </TableContainer>
                    </Box>
                )}

            </Paper>
        </Container>
        // <div>
        //     <h1>提出 #{submissionId} (課題: {problem?.title || '課題名不明'})</h1>
        //     <h1>提出されたファイル一覧</h1>
        //     <select onChange={handleUploadedFileSelect} value={selectedUploadedFile}>
        //         <option value="">ファイルを選択してください</option>
        //         {uploadedFiles.filter(file => typeof file.content === 'string').map(file => (
        //             <option key={file.name} value={file.name}>{file.name}</option>
        //         ))}
        //     </select>
        //     <CodeBlock code={getSelectedUploadedFileContent()} fileName={selectedUploadedFile} />
        //     <ul>
        //         {uploadedFiles.filter(file => file.content instanceof Blob).map(file => (
        //             <li key={file.name}>
        //                 <OfflineFileDownloadButton file={file} />
        //             </li>
        //         ))}
        //     </ul>
        //     <h1>用意されたファイル一覧</h1>
        //     <select onChange={handleArrangedFileSelect} value={selectedArrangedFile}>
        //         <option value="">ファイルを選択してください</option>
        //         {arrangedFiles.filter(file => typeof file.content === 'string').map(file => (
        //             <option key={file.name} value={file.name}>{file.name}</option>
        //         ))}
        //     </select>
        //     <CodeBlock code={getSelectedArrangedFileContent()} fileName={selectedArrangedFile} />
        //     <ul>
        //         {arrangedFiles.filter(file => file.content instanceof Blob).map(file => (
        //             <li key={file.name}>
        //                 <OfflineFileDownloadButton file={file} />
        //             </li>
        //         ))}
        //     </ul>

        //     {
        //         submission && problem && (
        //             <div>
        //                 <h1>提出結果</h1>
        //                 <table>
        //                     <tbody>
        //                         <tr>
        //                             <th>提出日時</th>
        //                             <td>{submission?.ts.toString()}</td>
        //                         </tr>
        //                         <tr>
        //                             <th>問題</th>
        //                             <td>{problem?.title}</td>
        //                         </tr>
        //                         <tr>
        //                             <th>ユーザ</th>
        //                             <td>{submission?.user_id}</td>
        //                         </tr>
        //                         <tr>
        //                             <th>得点</th>
        //                             <td>{submission?.score}</td>
        //                         </tr>
        //                         <tr>
        //                             <th>結果</th>
        //                             <td>{submission?.result}</td>
        //                         </tr>
        //                         <tr>
        //                             <th>実行時間</th>
        //                             <td>{submission?.timeMS}ms</td>
        //                         </tr>
        //                         <tr>
        //                             <th>メモリ</th>
        //                             <td>{submission?.memoryKB}KB</td>
        //                         </tr>
        //                     </tbody>
        //                 </table>
        //             </div>
        //         )
        //     }

        //     <div>
        //         <h1>メッセージ</h1>
        //         <p>{submission?.message || 'なし'}</p>
        //         <p>{'detail: ' +submission?.detail || ''}</p>
        //     </div>

        //     <h1>チェックリスト</h1>
        //     <CheckListTable>
        //         <thead>
        //             <tr>
        //                 <th></th>
        //                 <th>チェック項目</th>
        //                 <th>結果</th>
        //                 <th>実行時間</th>
        //                 <th>メモリ</th>
        //             </tr>
        //         </thead>
        //         <tbody>
        //             {submission?.judge_results.map((judge_result, index) => (
        //                 <React.Fragment key={index}>
        //                     <CheckListRow>
        //                         <td>
        //                             <ExpandButton onClick={() => toggleRow(index)}>
        //                                 {expandedRows.includes(index) ? '▼' : '▶'}
        //                             </ExpandButton>
        //                         </td>
        //                         <td>{testCaseId2TestCases.get(judge_result.testcase_id)?.description || ''}</td>
        //                         <td>{judge_result.result}</td>
        //                         <td>{judge_result.timeMS}ms</td>
        //                         <td>{judge_result.memoryKB}KB</td>
        //                     </CheckListRow>
        //                     {expandedRows.includes(index) && (
        //                         <ExpandedRow>
        //                             <td colSpan={5}>
        //                                 <JudgeResultsViewer result={judge_result} testCase={testCaseId2TestCases.get(judge_result.testcase_id)!} />
        //                             </td>
        //                         </ExpandedRow>
        //                     )}
        //                 </React.Fragment>
        //             ))}
        //         </tbody>
        //     </CheckListTable>
        // </div>
    );
};

export default SubmissionDetail;
