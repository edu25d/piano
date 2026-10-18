# 계단 읽기 연습장 진행 기록

## 현재 구현

- MusicXML XML/MXL 악보 렌더링, 14개 흰 건반과 반음 건반, Web Audio 소리 재생
- 정답·오답 시각 피드백, 음표 계이름, 계단/화살표 힌트
- 여러 줄 악보 스크롤, 음표 길이·마디 밀도에 따른 가로 간격 조정
- 가사 렌더링, 마디 번호 숨김, 크롬북용 고정 화면 배치
- 교사 화면 전환, Supabase Auth 이메일/비밀번호 로그인 및 계정 만들기 UI
- 교사 담당 반 등록, MusicXML 과제 업로드, 반별 학생 진행 대시보드 UI
- Supabase 연결 확인 API: `api/supabase-health.js`
- 교사 화면용 공개 설정 API: `api/supabase-config.js`
- 교사 화면 클라이언트: `teacher.js` (로그인, 반 관리, 악보 업로드, 기록 조회)
- 기본 데이터베이스 생성 SQL: `supabase/schema.sql`
- 교사 반 권한·대시보드·MusicXML 저장 권한 SQL: `supabase/teacher-screen.sql`

## Supabase와 Vercel

- 사용자가 Vercel 배포에서 `/api/supabase-health`가 `connected: true`, `schemaReady: true`를 반환했다고 확인했습니다. 이 검사는 기본 `classes` 테이블까지 확인합니다.
- Vercel 환경변수 이름은 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`입니다. 이전 키 이름인 `SUPABASE_SERVICE_ROLE_KEY`도 연결 API에서 호환됩니다.
- Secret key는 Vercel 서버 함수에서만 사용하고 브라우저로 보내지 않습니다. Publishable key만 `/api/supabase-config`에서 교사 로그인용으로 전달합니다.
- `.env`는 `.gitignore`에서 제외하고, 예시 변수 이름만 `.env.example`에 기록합니다.
- 로컬 `serve` 미리보기에는 Vercel API 함수가 실행되지 않습니다. 교사 Supabase 기능은 Vercel 배포 주소에서 확인해야 합니다.
- 교사 화면은 Vercel API의 `SUPABASE_PUBLISHABLE_KEY`가 없으면 미리보기에서 로그인되지 않습니다. 이 키도 Vercel `Production` 환경에 등록한 뒤 재배포해야 합니다.

## Supabase 설정 순서

1. Supabase SQL Editor에서 `supabase/schema.sql`을 실행합니다.
2. 교사 화면 권한을 적용하기 위해 `supabase/teacher-screen.sql`도 실행합니다.
3. Vercel 프로젝트의 `Settings > Environment Variables`에 `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `SUPABASE_PUBLISHABLE_KEY`가 `Production` 환경으로 등록되어 있는지 확인합니다.
4. Vercel을 다시 배포하고 `/api/supabase-health`에서 `connected: true`, `schemaReady: true`를 확인합니다.
5. 교사 계정은 Supabase Auth의 이메일/비밀번호를 사용합니다. 현재 화면의 계정 만들기는 공개 가입 방식입니다.

## 아직 남은 작업

- 학생의 학년 QR 접속, 반 선택, 이름 입력 화면
- 학생이 과제 또는 자유 연습곡을 선택하는 화면
- 음표별 정답·오답과 진행 위치를 Supabase에 자동 저장하고, 중단한 회차를 복원하는 API
- 학년별 QR 생성과 학생용 링크 연결
- 실제 학생 기록을 만든 뒤 교사 대시보드의 회차별 진행·정답률 집계를 검증하기
- 공개 교사 계정 만들기를 학교 초대/관리 방식으로 제한할지 결정

현재 교사 화면은 Supabase Auth로 로그인하고 담당 반·과제를 관리하며 DB의 학생/연습 회차를 읽도록 연결되어 있습니다. 다만 학생 쪽 QR 진입과 음표별 기록 저장 기능은 아직 구현되지 않아, 현재는 실제 학생 연습 기록이 생성되지 않습니다. 이 기능들을 이어서 연결하면 대시보드에 실데이터가 표시됩니다.
