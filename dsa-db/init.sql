-- read password from secrets
\set DSA_APP_PASSWORD `cat /run/secrets/db_app_password | tr -d '\n\r' | xargs`

CREATE USER dsa_app with PASSWORD :'DSA_APP_PASSWORD';
CREATE DATABASE dsa_db
WITH 
    OWNER postgres -- owned by superuser
    ENCODING = 'UTF8'
    LOCALE = 'ja_JP.UTF-8'
    TEMPLATE = template0;

-- set timezone
ALTER DATABASE dsa_db SET TIMEZONE TO 'Asia/Tokyo';

-- connect to the database
\c dsa_db;

-- create schema
CREATE SCHEMA IF NOT EXISTS public;

-- creating tables
CREATE TABLE IF NOT EXISTS UserRole (
    id INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

INSERT INTO UserRole (id, name) VALUES (1, 'admin'), (2, 'manager'), (3, 'student');

CREATE TABLE IF NOT EXISTS UserList (
    id SERIAL PRIMARY KEY,
    userid VARCHAR(255) NOT NULL UNIQUE,
    name VARCHAR(255) NOT NULL,
    hashed_password VARCHAR(255) NOT NULL,
    role_id INTEGER NOT NULL REFERENCES UserRole(id),
    disabled_at TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    email VARCHAR(255)
);

CREATE INDEX idx_userid ON UserList(userid);

CREATE TABLE IF NOT EXISTS LoginHistory (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(255) NOT NULL,
    login_at TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    logout_at TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    FOREIGN KEY (user_id) REFERENCES UserList(userid) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS FileLocation (
    id SERIAL PRIMARY KEY,
    path VARCHAR(511) NOT NULL,
    ts TIMESTAMP(0) WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS Lecture (
    id SERIAL PRIMARY KEY,
    title VARCHAR(255) NOT NULL,
    start_date TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    deadline TIMESTAMP(0) WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS Problem (
    lecture_id INTEGER NOT NULL,
    problem_id INTEGER NOT NULL,
    registered_at TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    title VARCHAR(255) NOT NULL,
    resource_location_id INTEGER NOT NULL REFERENCES FileLocation(id),
    detail JSONB NOT NULL,
    PRIMARY KEY (lecture_id, problem_id),
    FOREIGN KEY (lecture_id) REFERENCES Lecture(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS FileReference (
    id SERIAL PRIMARY KEY,
    lecture_id INTEGER NOT NULL,
    problem_id INTEGER NOT NULL,
    location_id INTEGER NOT NULL,
    FOREIGN KEY (lecture_id, problem_id) REFERENCES Problem(lecture_id, problem_id) ON DELETE CASCADE,
    FOREIGN KEY (location_id) REFERENCES FileLocation(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ResultValues (
    value INTEGER PRIMARY KEY,
    name VARCHAR(255) NOT NULL
);

INSERT INTO ResultValues (value, name) VALUES (0, 'AC'), (1, 'WA'), (2, 'RE'), (3, 'TLE'), (4, 'MLE'), (5, 'OLE'), (6, 'CE'), (7, 'IE'), (8, 'FN'), (9, 'Judging'), (10, 'WJ');

CREATE TABLE IF NOT EXISTS ValidationRequest (
    id SERIAL PRIMARY KEY,
    ts TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    usercode INTEGER NOT NULL,
    lecture_id INTEGER NOT NULL,
    problem_id INTEGER NOT NULL,
    upload_dir_id INTEGER NOT NULL REFERENCES FileLocation(id),
    result INTEGER NOT NULL REFERENCES ResultValues(value),
    log JSONB NOT NULL,
    FOREIGN KEY (usercode) REFERENCES UserList(id) ON DELETE CASCADE,
    FOREIGN KEY (lecture_id, problem_id) REFERENCES Problem(lecture_id, problem_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS GradingRequest (
    lecture_id INTEGER NOT NULL,
    problem_id INTEGER NOT NULL,
    usercode INTEGER NOT NULL,
    submission_ts TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    id SERIAL NOT NULL UNIQUE,
    ts TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    request_usercode INTEGER NOT NULL,
    upload_dir_id INTEGER NOT NULL REFERENCES FileLocation(id),
    result INTEGER NOT NULL REFERENCES ResultValues(value),
    log JSONB NOT NULL,
    FOREIGN KEY (lecture_id, problem_id) REFERENCES Problem(lecture_id, problem_id) ON DELETE CASCADE,
    FOREIGN KEY (usercode) REFERENCES UserList(id) ON DELETE CASCADE,
    FOREIGN KEY (request_usercode) REFERENCES UserList(id) ON DELETE CASCADE,
    PRIMARY KEY (lecture_id, problem_id, usercode, submission_ts)
);

CREATE INDEX idx_grading_request ON GradingRequest (id);

CREATE TABLE IF NOT EXISTS JobQueue (
    id SERIAL PRIMARY KEY,
    request_type VARCHAR(255) NOT NULL,
    request_id INTEGER NOT NULL,
    status VARCHAR(255) NOT NULL,
    created_at TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    detail JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS ResultQueue (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL,
    created_at TIMESTAMP(0) WITH TIME ZONE NOT NULL,
    result INTEGER NOT NULL REFERENCES ResultValues(value),
    log JSONB NOT NULL,
    FOREIGN KEY (job_id) REFERENCES JobQueue(id) ON DELETE CASCADE
);

-- setting of grant
GRANT CONNECT ON DATABASE dsa_db TO dsa_app;
GRANT USAGE ON SCHEMA public TO dsa_app;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM dsa_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO dsa_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO dsa_app; -- this is necessary for serial primary key
REVOKE INSERT, UPDATE, DELETE ON UserRole FROM dsa_app;
REVOKE INSERT, UPDATE, DELETE ON ResultValues FROM dsa_app;
