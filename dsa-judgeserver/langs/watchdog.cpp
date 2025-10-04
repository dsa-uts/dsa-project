#include <fcntl.h>
#include <poll.h>
#include <signal.h>
#include <sys/resource.h>
#include <sys/types.h>
#include <sys/wait.h>
#include <unistd.h>
#include <atomic>
#include <chrono>
#include <fstream>
#include <iostream>
#include <nlohmann/json.hpp>
#include <sstream>
#include <string>
#include <thread>
#include <vector>

#define MAX_STDOUT_LENGTH 4096
#define MAX_STDERR_LENGTH 4096

using json = nlohmann::json;

json readFromStdin() {
  std::string line;
  std::string jsonString;

  while (std::getline(std::cin, line)) {
    jsonString += line;
  }

  try {
    return json::parse(jsonString);
  } catch (const json::parse_error& e) {
    std::printf("Error parsing input JSON: %s\n", e.what());
    exit(1);
  }
}

json readFromFile(const std::string& filename) {
  std::ifstream file(filename);
  if (!file.is_open()) {
    std::perror("Failed to open file");
    exit(1);
  }
  std::string jsonString((std::istreambuf_iterator<char>(file)), std::istreambuf_iterator<char>());
  return json::parse(jsonString);
}

std::vector<pid_t> get_child_pids(pid_t parent_pid) {
  std::vector<pid_t> children;
  std::string cmd = std::string("pgrep -P ") + std::to_string(parent_pid);

  // コマンドを実行
  FILE* stream = popen(cmd.c_str(), "r");
  if (!stream) {
    throw std::runtime_error("popen failed");
  }

  char buffer[128];
  while (fgets(buffer, sizeof(buffer), stream) != nullptr) {
    pid_t pid = std::stoi(std::string(buffer));
    children.push_back(pid);
  }

  pclose(stream);
  return children;
}

class BoundedString : public std::string {
 private:
  size_t max_capacity;
  std::string error_message;

  void checkAndTrim(const std::string& addition) {
    if (this->length() + addition.length() > max_capacity) {
      std::string tmp = this->c_str();
      tmp += addition;
      tmp = tmp.substr(0, max_capacity - error_message.length() - 10);
      tmp += error_message;
      std::string::operator=(tmp);
      throw std::length_error(error_message);
    }
  }

 public:
  BoundedString(size_t capacity) : max_capacity(capacity) {
    error_message = std::string("...\n") +
                    "capacity(" + std::to_string(capacity) + "bytes) exceeded\n";
  }

  BoundedString& operator+=(const std::string& str) {
    checkAndTrim(str);
    std::string::operator+=(str);
    return *this;
  }

  BoundedString& operator+=(const char* str) {
    checkAndTrim(str);
    std::string::operator+=(str);
    return *this;
  }

  BoundedString& operator+=(char c) {
    checkAndTrim(std::string(1, c));
    std::string::operator+=(c);
    return *this;
  }

  BoundedString& operator=(const std::string& str) {
    std::string::operator=("");
    checkAndTrim(str);
    std::string::operator=(str);
    return *this;
  }

  size_t remaining() const { return max_capacity - this->length(); }
};

void kill_recursive(pid_t pid) {
  try {
    // まず子プロセスを終了
    std::vector<pid_t> children = get_child_pids(pid);
    for (pid_t child : children) {
      kill_recursive(child);
    }

    // 対象プロセスを終了
    if (kill(pid, SIGKILL) < 0) {
      // std::cerr << "Failed to kill process " << pid << std::endl;
    }
  } catch (const std::exception& e) {
    std::cerr << "Error in kill_recursive: " << e.what() << std::endl;
  }
}

bool is_process_alive(pid_t pid) {
  if (kill(pid, 0) == 0) {
    return true;
  }
  return errno != ESRCH;
}

int main(int argc, char** argv) {
  json jsonData;
  if (argc == 2) {
    jsonData = readFromFile(argv[1]);
  } else {
    jsonData = readFromStdin();
  }

  /**
   * JSONデータは以下のような形式になっている
   * {
   *   "command": "cmd [args...]",
   *   "stdin": "stdin data",
   *   "timeoutMS": 3000,
   *   "memoryLimitMB": 1024,
   *   "uid": 1000,
   *   "gid": 1000
   * }
   */
  std::string command;
  std::string stdin_str;
  int timeoutMS = 0;
  int memoryLimitMB = 0;
  int uid = 0;
  int gid = 0;
  try {
    command = jsonData.at("command");
    stdin_str = jsonData.at("stdin");
    timeoutMS = jsonData.at("timeoutMS");
    memoryLimitMB = jsonData.at("memoryLimitMB");
    uid = jsonData.at("uid");
    gid = jsonData.at("gid");
  } catch (const json::out_of_range& e) {
    std::printf("Key not found: %s\n", e.what());
    exit(1);
  }

  int stdin_pipe[2];
  int stdout_pipe[2];
  int stderr_pipe[2];

  if (pipe(stdout_pipe) == -1 || pipe(stderr_pipe) == -1 || pipe(stdin_pipe) == -1) {
    std::perror("pipe failed");
    exit(1);
  }

  pid_t pid = fork();
  if (pid == -1) {
    // フォーク失敗
    std::perror("fork failed");
    exit(1);
  } else if (pid == 0) {
    // 子プロセス
    // 標準出力と標準エラーをパイプにリダイレクト
    close(STDOUT_FILENO);
    close(STDERR_FILENO);
    dup2(stdout_pipe[1], STDOUT_FILENO);
    dup2(stderr_pipe[1], STDERR_FILENO);
    close(stdout_pipe[0]);
    close(stderr_pipe[0]);
    close(stdout_pipe[1]);
    close(stderr_pipe[1]);

    // プロセス権限の変更
    if (setgid(gid) != 0) {
      std::perror("setgid failed");
      exit(1);
    }
    if (setuid(uid) != 0) {
      std::perror("setuid failed");
      exit(1);
    }

    // stdin_pipe[0]から標準入力を読み込む
    close(stdin_pipe[1]);
    close(STDIN_FILENO);
    dup2(stdin_pipe[0], STDIN_FILENO);
    close(stdin_pipe[0]);

    // 対象コマンドを実行
    execl("/bin/sh", "sh", "-c", command.c_str(), NULL);
    std::perror("execl failed");
    exit(1);
  } else {
    // 親プロセス
    close(stdout_pipe[1]);
    close(stderr_pipe[1]);
    close(stdin_pipe[0]);

    int exit_code = -1;
    BoundedString stdout_str(MAX_STDOUT_LENGTH + 100);
    BoundedString stderr_str(MAX_STDERR_LENGTH + 100);
    int timeMS = 0;
    int memoryKB = 0;
    bool OLE = false; // Output Limit Exceeded

    auto start_time = std::chrono::steady_clock::now();
    std::atomic<bool> finished(false);
    int64_t max_memory = 0;

    // タイムアウト用のタイマースレッド
    std::thread timeout_thread([&]() {
      while (!finished.load()) {
        auto now = std::chrono::steady_clock::now();
        // printf("%ldms elapsed, finished: %d\n", std::chrono::duration_cast<std::chrono::milliseconds>(now - start_time).count(), finished.load());
        if (std::chrono::duration_cast<std::chrono::milliseconds>(now - start_time).count() >= timeoutMS) {
          // タイムアウト
          // printf("timeout, kill %d\n", pid);
          // shで実行している場合、子プロセスが残っているため、再帰的に終了する必要がある。
          // そうしないと、子プロセスが実行され続けてしまうし、stdoutやstderrがパイプにEOFが送られない。
          finished.store(true);
          kill_recursive(pid);
          // printf("waitpid: %d\n", waitpid(pid, NULL, 0));
          break;
        }
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
      }
      if (is_process_alive(pid)) {
        kill_recursive(pid);
      }
    });

    // リソース監視スレッド
    std::thread monitor_thread([&]() {
      std::ifstream mem_file("/sys/fs/cgroup/memory.current");
      char buffer[4096];
      while (!finished.load()) {
        // メモリ使用量を取得
        int64_t current_memory;
        if (mem_file.is_open()) {
          mem_file >> current_memory;
          mem_file.seekg(0);
        }

        if (current_memory > max_memory) {
          max_memory = current_memory;
        }

        if (current_memory >
            static_cast<int64_t>(memoryLimitMB) * 1024 * 1024) {
          // メモリ制限超過
          finished.store(true);
          break;
        }

        // 標準出力を取得(リアルタイム)
        try {
          // poll stdout_pipe[0] to check it is readable
          pollfd fds[1];
          fds[0].fd = stdout_pipe[0];
          fds[0].events = POLLIN;
          int ret = poll(fds, 1, 0);
          if (ret > 0) {
            // if readable, read from stdout_pipe[0]
            ssize_t count;
            if ((count = read(stdout_pipe[0], buffer, sizeof(buffer))) > 0) {
              // printf("reading %ld bytes from stdout\n", count);
              stdout_str += std::string(buffer, count);
            }
          }
        } catch (const std::length_error& e) {
          finished.store(true);
          OLE = true;
          break;
        }

        // 標準エラーを取得(リアルタイム)
        try {
          // poll stderr_pipe[0] to check it is readable
          pollfd fds[1];
          fds[0].fd = stderr_pipe[0];
          fds[0].events = POLLIN;
          int ret = poll(fds, 1, 0);
          if (ret > 0) {
            // if readable, read from stderr_pipe[0]
            ssize_t count;
            if ((count = read(stderr_pipe[0], buffer, sizeof(buffer))) > 0) {
              // printf("reading %ld bytes from stderr\n", count);
              stderr_str += std::string(buffer, count);
            }
          }
        } catch (const std::length_error& e) {
          finished.store(true);
          break;
        }

        std::this_thread::sleep_for(std::chrono::milliseconds(10));
      }
      mem_file.close();
    });

    // 子プロセスに標準入力を流す
    {
      int remaining = stdin_str.size();
      const char* ptr = stdin_str.c_str();
      while (remaining > 0) {
        int written = write(stdin_pipe[1], ptr, remaining);
        if (written <= 0) {
          std::perror("write to stdin pipe failed");
          exit(1);
        }
        remaining -= written;
        ptr += written;
      }
    }
    // EOFを送信
    close(stdin_pipe[1]);

    // 子プロセスの終了を待つ
    int status;
    waitpid(pid, &status, 0);
    finished.store(true);
    monitor_thread.join();
    // printf("monitor thread finished\n");
    // 実行時間を計算
    auto end_time = std::chrono::steady_clock::now();
    timeMS = std::chrono::duration_cast<std::chrono::milliseconds>(end_time - start_time).count();

    timeout_thread.join();
    // printf("timeout thread finished\n");

    // 最大メモリ使用量 (KB)
    memoryKB = static_cast<int>(max_memory) / 1024;

    // 残りの標準出力を取得
    try {
      char buffer[4096];
      ssize_t count;
      while ((count = read(stdout_pipe[0], buffer, sizeof(buffer))) > 0) {
        stdout_str += std::string(buffer, count);
      }
    } catch (const std::length_error& e) {
      OLE = true;
    }

    // 残りの標準エラーを取得
    try {
      char buffer[4096];
      ssize_t count;
      while ((count = read(stderr_pipe[0], buffer, sizeof(buffer))) > 0) {
        stderr_str += std::string(buffer, count);
      }
    } catch (const std::length_error& e) {
      OLE = true;
    }

    close(stdout_pipe[0]);
    close(stderr_pipe[0]);

    if (WIFEXITED(status)) {
      exit_code = WEXITSTATUS(status);
    } else if (WIFSIGNALED(status)) {
      exit_code = 128 + WTERMSIG(status);
    } else {
      exit_code = -1;
    }

    // 結果をJSONで出力
    json result;
    result["exit_code"] = exit_code;
    result["stdout"] = stdout_str;
    result["stderr"] = stderr_str;
    result["timeMS"] = timeMS;
    result["memoryKB"] = memoryKB;
    result["TLE"] = timeoutMS > 0 && timeMS >= timeoutMS;
    result["MLE"] = memoryLimitMB > 0 && memoryKB / 1024 >= memoryLimitMB;
    result["OLE"] = OLE;
    std::cout << result.dump(4) << std::endl;
  }
}
