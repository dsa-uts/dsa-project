import React, { useEffect, useState } from "react";
import { Lecture, Problem } from "../types/Assignments";
import { deleteProblem, deleteLecture } from "../api/DeleteAPI";
import { fetchLectures, downloadProblem, downloadTemplate } from "../api/GetAPI";
import { mergeLectureAndAddProblem, updateProblem } from "../api/PostAPI";
import useApiClient from "../hooks/useApiClient";
import { useAuth } from "../context/AuthContext";
import { UserRole } from "../types/token";
import { useNavigate } from "react-router-dom";
import { DateTimePicker } from "@mui/x-date-pickers/DateTimePicker";
import { LocalizationProvider } from "@mui/x-date-pickers/LocalizationProvider";
import { AdapterDateFns } from "@mui/x-date-pickers/AdapterDateFnsV3";
import { ja } from 'date-fns/locale/ja'; // 日本語のロケールをインポート


import {
  Container,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  TextField,
  Button,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TableRow,
  Paper,
  IconButton
} from '@mui/material';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';

const ProblemUpdatePage: React.FC = () => {
  const { token, role } = useAuth();
  const { apiClient } = useApiClient();

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const [lectureList, setLectureList] = useState<Lecture[]>([]);
  const [selectedLectureId, setSelectedLectureId] = useState<number | "new">("new");

  const [lectureId, setLectureId] = useState<number>(0);
  const [lectureTitle, setLectureTitle] = useState<string>("");
  const [startDate, setStartDate] = useState<Date>(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
  const [endDate, setEndDate] = useState<Date>(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));

  const [deleteLecturemode, setDeleteLecturemode] = useState<boolean>(false);

  // 小問テーブル用の状態
  type ProblemRow = {
    id: number;
    title: string;
    file: File | null;
    isNew: boolean;
    toDelete: boolean;
  };
  const [problemRows, setProblemRows] = useState<ProblemRow[]>([]);

  if (role !== UserRole.admin && role !== UserRole.manager) {
    // 管理者のみアクセス可能ですというメッセージを表示してホームにリダイレクト
    alert("管理者のみアクセス可能です");
    navigate("/");
  }

  useEffect(() => {
    const fetchAllLectures = async () => {
      try {
        const lectures = await apiClient({ apiFunc: fetchLectures, args: [/*all = */true] });
        setLectureList(lectures);
      } catch (error) {
        setError("講義一覧の取得に失敗しました");
      }
    }

    fetchAllLectures();
  }, [token]);

  // 大問が選択されたときの処理
  useEffect(() => {
    if (selectedLectureId === "new") {
      setDeleteLecturemode(false);
      setProblemRows([]);
      setLectureId(0);
      setLectureTitle("");
      setStartDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      setEndDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
    } else {
      setDeleteLecturemode(false);
      const lecture = lectureList.find(l => l.id === selectedLectureId);
      // console.log(typeof lecture?.start_date);
      // console.log(typeof lecture?.end_date);
      if (lecture) {
        setProblemRows(lecture.problems.map(p => (
          {
            id: p.assignment_id,
            title: p.title,
            file: null,
            isNew: false,
            toDelete: false
          }
        )));
        setLectureId(lecture.id);
        setLectureTitle(lecture.title);
        setStartDate(lecture.start_date);
        setEndDate(lecture.end_date);
      }
    }
  }, [selectedLectureId, lectureList]);

  // 新しい小問行を追加
  const handleAddProblemRow = () => {
    setProblemRows([...problemRows, 
      {
        id: Math.floor(Math.random() * 1000000) + 900,
        title: "",
        file: null,
        isNew: true,
        toDelete: false
      }
    ]);
  };

  // テンプレートダウンロード処理
  const handleTemplateDownload = async () => {
    try {
      const result = await apiClient({ apiFunc: downloadTemplate, args: []});
      // ヘッダーの"Content-Disposition: attachment; filename="(filename)"を取得
      const contentDisposition = result.headers['content-disposition'];
      let filename = 'template.zip';

      if (contentDisposition) {
        const filenameRegex = /filename="([^"]+)"/;
        const matches = filenameRegex.exec(contentDisposition);
        if (matches != null && matches[1]) {
          filename = matches[1];
        }
      }

      // ダウンロード処理の実装
      const url = window.URL.createObjectURL(result.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setError("テンプレートのダウンロードに失敗しました");
    }
  };

  const handleDownloadProblem = async (lecture_id: number, assignment_id: number) => {
    try {
      const result = await apiClient({ apiFunc: downloadProblem, args: [lecture_id, assignment_id] });
      // ヘッダーのContent-Disposition: attachment; filename="(filename)"を取得
      const contentDisposition = result.headers['content-disposition'];
      let filename = 'problem.zip';

      if (contentDisposition) {
        const filenameRegex = /filename="([^"]+)"/;
        const matches = filenameRegex.exec(contentDisposition);
        if (matches != null && matches[1]) {
          filename = matches[1];
        }
      }

      const url = window.URL.createObjectURL(result.data);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
      window.URL.revokeObjectURL(url);
    } catch (error) {
      setError("小問のダウンロードに失敗しました");
    }
  };

  // 適用ボタンの処理
  const handleApply = async () => {
    try {
      if (deleteLecturemode) {
        await apiClient({
          apiFunc: deleteLecture,
          args: [lectureId]
        });
        setDeleteLecturemode(false);
        navigate("/");
        return;
      }
      // 大問の処理
      if (selectedLectureId === "new") {
        if (lectureId === 0) {
          setError("大問IDが未入力です");
          return;
        }
        if (lectureTitle === "") {
          setError("大問タイトルが未入力です");
          return;
        }
      }

      await apiClient({
        apiFunc: mergeLectureAndAddProblem,
        args: [lectureId, lectureTitle, startDate, endDate, false, null]
      });

      // 小問の処理
      for (const row of problemRows) {
        if (row.toDelete && !row.isNew) {
          // 既存の小問を削除
          await apiClient({
            apiFunc: deleteProblem,
            args: [lectureId, row.id]
          });
        } else if (row.file) {
          if (row.isNew) {
            // 新規小問を追加
            await apiClient({
              apiFunc: mergeLectureAndAddProblem,
              args: [
                lectureId,
                lectureTitle,
                startDate,
                endDate,
                true,
                row.file
              ]
            });
          } else {
            // 既存の小問を更新
            await apiClient({
              apiFunc: updateProblem,
              args: [lectureId, row.file]
            })
          }
        }
      }

      navigate("/");
    } catch (error) {
      setError("更新に失敗しました");
    }
  };

  const handleDeleteLectureButton = () => {
    if (selectedLectureId !== "new") {
      setDeleteLecturemode(!deleteLecturemode);
    } else {
      setDeleteLecturemode(false);
      setLectureId(0);
      setLectureTitle("");
      setStartDate(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
      setEndDate(new Date(Date.now() + 365 * 24 * 60 * 60 * 1000));
      setProblemRows([]);
    }
  }

  return (
    <Container maxWidth="lg">
      <h1>課題追加</h1>

      <Paper sx={{p: 2, mb: 2, backgroundColor: deleteLecturemode ? "#ffebee" : "inherit"}}>
        <FormControl fullWidth sx={{mb: 2}}>
          <InputLabel>大問選択</InputLabel>
          <Select
            value={selectedLectureId}
            onChange={(e) => setSelectedLectureId(e.target.value as number | "new")}>
            <MenuItem value="new">新規追加</MenuItem>
            {lectureList.map(lecture => (
              <MenuItem key={lecture.id} value={lecture.id}>
                {lecture.title}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <>
          <TextField
            fullWidth
            label="課題ID"
            type="number"
            value={lectureId.toString()}
            onChange={(e) => setLectureId(Number(e.target.value))}
            sx={{mb: 2}}
          />
          <TextField
            fullWidth
            label="課題名"
            value={lectureTitle}
            onChange={(e) => setLectureTitle(e.target.value)}
            sx={{mb: 2}}
          />
        </>
        <LocalizationProvider dateAdapter={AdapterDateFns} adapterLocale={ja}>
          <FormControl fullWidth sx={{mb: 2}}>
            <DateTimePicker
              label="開始日時"
              value={startDate}
              onChange={(newValue) => setStartDate(newValue || new Date())}
              slotProps={{
                textField: {
                  fullWidth: true,
                }
              }}
            />
          </FormControl>
          <FormControl fullWidth sx={{mb: 2}}>
            <DateTimePicker
              label="終了日時"
              value={endDate}
              onChange={(newValue) => setEndDate(newValue || new Date())}
              slotProps={{
                textField: {
                  fullWidth: true,
                }
              }}
            />
          </FormControl>
        </LocalizationProvider>


        <Button
          variant="contained"
          color="error"
          onClick={handleDeleteLectureButton}
        >
          削除
        </Button>
      </Paper>

      <Paper sx={{p: 2, backgroundColor: deleteLecturemode ? "#ffebee" : "inherit"}}>
        <h2>小問設定</h2>
        <Button
          variant="contained"
          onClick={handleTemplateDownload}
          sx={{mb: 2}}
        >
          テンプレートをダウンロード
        </Button>

        <TableContainer>
          <Table>
            <TableHead>
              <TableRow>
                <TableCell>ID</TableCell>
                <TableCell>タイトル</TableCell>
                <TableCell>最新のデータ</TableCell>
                <TableCell>{/* ファイルアップロード */}</TableCell>
                <TableCell>{/* 削除 */}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {problemRows.map((row, index) => (
                <TableRow
                  key={row.id}
                  sx={{
                    backgroundColor: row.toDelete ? "#ffebee" : "inherit"
                  }}
                >
                  <TableCell>{row.id >= 900 ? "-" : row.id}</TableCell>
                  <TableCell>{row.title}</TableCell>
                  <TableCell>
                    {!row.isNew && (
                      <Button
                        onClick={() => handleDownloadProblem(lectureId, row.id)}
                      >
                        ダウンロード
                      </Button>
                    )}
                  </TableCell>
                  <TableCell>
                    <Button component="label" disabled={deleteLecturemode}>
                      アップロード
                      <input
                        type="file"
                        hidden
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          // console.log(file);
                          if (file) {
                            const newRows = [...problemRows];
                            newRows[index].file = file;
                            setProblemRows(newRows);
                          }
                        }}
                      />
                      {
                        row.file && (
                          // ファイル名を表示
                          <span> ({row.file.name}) </span>
                        )
                      }
                    </Button>
                  </TableCell>
                  <TableCell>
                    <IconButton
                      onClick={() => {
                        if (row.isNew) {
                          setProblemRows(problemRows.filter((_, i) => i !== index));
                        } else {
                          const newRows = [...problemRows];
                          newRows[index].toDelete = !newRows[index].toDelete;
                          setProblemRows(newRows);
                        }
                      }}
                      disabled={deleteLecturemode}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>

        <Button
          startIcon={<AddIcon />}
          onClick={handleAddProblemRow}
          sx={{mt: 2}}
          disabled={deleteLecturemode}
        >
          追加
        </Button>

        <Button
          variant="contained"
          color="primary"
          onClick={handleApply}
          sx={{mt: 2, ml: 2}}
        >
          適用
        </Button>
      </Paper>
    </Container>
  );
};

export default ProblemUpdatePage;

