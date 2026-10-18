# 계단 읽기 연습장 진행 기록

## 현재 구현

- MusicXML XML/MXL 악보 렌더링, 14개 흰 건반과 반음 건반, Web Audio 소리 재생
- 정답·오답 시각 피드백, 음표 계이름, 계단/화살표 힌트
- 여러 줄 악보 스크롤, 음표 길이·마디 밀도에 따른 가로 간격 조정
- 가사 렌더링, 마디 번호 숨김, 크롬북용 고정 화면 배치
- 교사 화면 전환, Supabase Auth 이메일/비밀번호 로그인 및 계정 만들기 UI
- 교사 담당 반 등록, MusicXML 과제 업로드, 반별 학생 진행 대시보드 UI
- 교사 현황/반·곡 관리 탭 분리, 연습곡 목록 선택 후 과제 등록, 파일 업로드 경로 한글 제거
- 교사 소유 연습곡 CRUD, 기본곡 교사별 override, 기록 보존을 위한 숨김 처리
- 학급별 QR 생성, 학생 반·이름 입력 및 과제/자유 연습곡 선택 UI
- 기본 주소는 교사 전용 로그인으로 시작하고, 학생은 반별 `?join=1&classId=...` QR 링크로만 입장
- 학생 QR 링크의 학급 ID는 서버에서 확인해 입장 반을 고정
- 학생용 서버 API: 반 목록, 서명된 악보 URL, 연습 회차 생성/이어하기, 음표별 정답·오답 기록
- 기본 자유 연습곡 3곡: 작은 별, 도레미 산책, 높낮이 다리
- `supabase/student-flow.sql`: 음표 진행 복원용 컬럼, 중복 답변 방지 키, 기본 자유 연습곡 데이터
- Supabase 연결 확인 API: `api/supabase-health.js`
- 교사 화면용 공개 설정 API: `api/supabase-config.js`
- 교사 화면 클라이언트: `teacher.js` (로그인, 반 관리, 악보 업로드, 기록 조회)
- 기본 데이터베이스 생성 SQL: `supabase/schema.sql`
- 교사 반 권한·대시보드·MusicXML 저장 권한 SQL: `supabase/teacher-screen.sql`
- 교사 개인 연습곡 권한·Storage 경로 SQL: `supabase/teacher-library.sql`

## Supabase와 Vercel

- 사용자가 Vercel 배포에서 `/api/supabase-health`가 `connected: true`, `schemaReady: true`를 반환했다고 확인했습니다. 이 검사는 기본 `classes` 테이블까지 확인합니다.
- 사용자가 `supabase/teacher-screen.sql`, `supabase/student-flow.sql` 실행 및 Vercel `SUPABASE_PUBLISHABLE_KEY` 등록을 확인했습니다.
- 사용자가 갱신된 `supabase/teacher-library.sql` 실행을 확인했습니다.
- 과제 업로드 화면의 `Invalid key` 오류는 Supabase Storage 경로에 원본 한글 파일명을 포함한 것이 원인으로 확인되어, UUID와 확장자만 사용하는 경로로 변경했습니다.
- 현재 작업 코드에서 기본 주소는 교사 전용이고 학생은 학급별 QR의 `classId`로 입장하며, 상단 모드 전환은 제거했습니다.
- 제공된 Vercel 주소는 아직 이전 접속 흐름을 서비스합니다. 배포 HTML에 이전 교사/학생 전환과 학년 QR이 남아 있고, 새 `/api/student-portal?action=class` 경로도 배포되어 있지 않습니다.
- Vercel 환경변수 이름은 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`입니다. 이전 키 이름인 `SUPABASE_SERVICE_ROLE_KEY`도 연결 API에서 호환됩니다.
- Secret key는 Vercel 서버 함수에서만 사용하고 브라우저로 보내지 않습니다. Publishable key만 `/api/supabase-config`에서 교사 로그인용으로 전달합니다.
- `.env`는 `.gitignore`에서 제외하고, 예시 변수 이름만 `.env.example`에 기록합니다.
- 로컬 `serve` 미리보기에는 Vercel API 함수가 실행되지 않습니다. 교사 Supabase 기능은 Vercel 배포 주소에서 확인해야 합니다.
- 로컬 정적 미리보기에는 Vercel API 함수가 없어 교사/학생 Supabase 흐름을 검증할 수 없습니다. Vercel의 읽기 전용 상태 확인은 통과했으며, 교사 로그인 이후 반 등록과 학생 기록 저장 end-to-end 확인이 남아 있습니다.

## Supabase 설정 순서

1. Supabase SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. 교사 화면 권한을 적용하기 위해 `supabase/teacher-screen.sql`도 실행합니다.
3. 학생 기록 저장과 자유 연습곡을 위해 `supabase/student-flow.sql`을 실행합니다.
4. 교사 연습곡 목록 CRUD를 위해 `supabase/teacher-library.sql`을 실행합니다.
5. Vercel 프로젝트의 `Settings > Environment Variables`에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`가 `Production` 환경으로 등록되어 있는지 확인합니다.
6. Vercel을 다시 배포하고 `/api/supabase-health`에서 `connected: true`, `schemaReady: true`를 확인합니다.
7. 교사 계정은 Supabase Auth의 이메일/비밀번호를 사용합니다. 현재 화면의 계정 만들기는 공개 가입 방식입니다.

## 아직 남은 작업

- 실제 Vercel 배포에서 학생 입장→과제 선택→연습→재접속 이어하기 흐름을 end-to-end로 검증하기
- 실제 학생 연습 기록이 생성된 뒤 교사 대시보드의 회차별 진행·정답률 집계를 확인하기
- 실제 교사 로그인 상태에서 기본곡 수정/숨김과 새 악보 과제 등록을 확인하기
- 공개 교사 계정 만들기를 학교 초대/관리 방식으로 제한할지 결정

학생은 현재 반과 이름으로 식별되며, 같은 반 동명이인은 이름 뒤에 숫자를 붙여 구분합니다. 별도 학생 비밀번호/인증 코드는 없으므로 성적처럼 민감한 데이터의 인증 수단으로 사용하면 안 됩니다. 교사용 기록 접근은 교사 로그인과 담당 반 RLS 정책으로 제한합니다.

교사 화면과 학생 QR 기능은 Vercel 서버리스 API가 있는 배포 주소에서 검증해야 합니다. 로컬 정적 미리보기에는 `/api/*` 함수가 없습니다. 사용자는 `student-flow.sql` migration을 이미 실행했다고 확인했습니다.
