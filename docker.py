#!/usr/bin/env python3

import shutil
import subprocess
import sys

# Detect whether to use 'docker-compose' or 'docker compose'


def get_docker_compose_command():
    if shutil.which("docker-compose"):
        return "docker-compose"
    else:
        try:
            subprocess.run(['docker', 'compose', 'version'],
                           capture_output=True, check=True)
            return "docker compose"
        except:
            print("Error: Doker Compose is not installed.")
            sys.exit(1)

# Execute a command


def run_command(cmd_list: list[str]):
    print(f"\n🚀 Executing: {' '.join(cmd_list)}\n")

    try:
        subprocess.run(cmd_list, check=True)
    except subprocess.CalledProcessError as e:
        print(f"\n❌ Command failed with exit code {e.returncode}")
        sys.exit(1)
    except KeyboardInterrupt:
        print("\n⚠️  Interrupted by user")
        sys.exit(0)


def main():
    docker_compose = get_docker_compose_command()

    if len(sys.argv) < 2:
        print("""
📦 Docker Environment Manager

Usage:
    python3 docker.py [command]

Commands:
    dev           Start development environment
    dev build     Build development environment  
    dev down      Stop development environment
    dev logs      Show development logs
    
    prod          Start production environment (detached)
    prod build    Build production environment
    prod down     Stop production environment
    prod logs     Show production logs

Examples:
    python3 docker.py dev
    python3 docker.py dev build
    python3 docker.py prod
        """)
        sys.exit(0)

    command = ' '.join(sys.argv[1:])

    if docker_compose == 'docker compose':
        base_cmd = ['docker', 'compose']
    else:
        base_cmd = ['docker-compose']

    # Commands for development
    if command == 'dev':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml',
                          '-f', 'docker-compose.dev.yaml', 'up']
        run_command(cmd)

    elif command == 'dev build':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml', '-f',
                          'docker-compose.dev.yaml', 'build']
        run_command(cmd)

    elif command == 'dev down':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml',
                          '-f', 'docker-compose.dev.yaml', 'down']
        run_command(cmd)

    elif command == 'dev logs':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml',
                          '-f', 'docker-compose.dev.yaml', 'logs', '-f']
        run_command(cmd)

    # Commands for production
    elif command == 'prod':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml',
                          '-f', 'docker-compose.prod.yaml', 'up', '-d']
        run_command(cmd)

    elif command == 'prod build':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml', '-f',
                          'docker-compose.prod.yaml', 'build']
        run_command(cmd)

    elif command == 'prod down':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml',
                          '-f', 'docker-compose.prod.yaml', 'down']
        run_command(cmd)

    elif command == 'prod logs':
        cmd = base_cmd + ['-f', 'docker-compose.base.yaml',
                          '-f', 'docker-compose.prod.yaml', 'logs', '-f']
        run_command(cmd)

    else:
        print(f"❌ Unknown command: {command}")
        print("Run 'python3 docker.py' to see available commands")
        sys.exit(1)


if __name__ == "__main__":
    main()
