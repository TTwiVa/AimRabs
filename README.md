# AimRabs

**60초 웹 에임 테스트** | [서비스 접속](http://15.164.224.47) | [GitHub 저장소](https://github.com/TTwiVa/AimRabs)

## 1. 서비스 소개

AimRabs는 별도 설치나 회원가입 없이 마우스 클릭 정확도와 반응을 시험하고, 다른 사용자와 점수를 비교할 수 있는 웹서비스입니다. 간단한 에임 연습과 기록 비교를 원하는 사용자를 대상으로 합니다.

| 핵심 기능 | 동작 방식 |
| --- | --- |
| 게임 시작 | 닉네임(1~16자) 입력 → 3·2·1 카운트다운 → 서버에 게임 세션 생성 |
| 60초 에임 테스트 | 무작위 위치의 원을 클릭하면 1점 획득, 60초 종료 시 최종 점수 제출 |
| 온라인 랭킹 | 서버에 저장된 점수로 전체 TOP 10과 개인 순위 조회 |

추가로 **다시 도전, 닉네임 변경, 랭킹 새로고침**을 지원합니다. 클릭 판정과 타이머는 브라우저에서 처리하고, 게임 세션·점수·랭킹은 서버에서 관리합니다.

## 2. AWS 구성도 및 서비스 선택 이유

```text
사용자 브라우저
    │ HTTP :80
    ▼
Elastic IP (15.164.224.47)
    │
    ▼
AWS EC2 (Ubuntu, t3.micro / 서울 리전)
    └─ Docker Compose
       ├─ Nginx (:80) ── 정적 웹페이지 제공
       │       └─ /api/* 요청 전달
       └─ FastAPI (:8000, 외부 미공개)
                └─ SQLite (/data/aimrabs.sqlite3)
                     └─ Docker Volume → EBS
```

- **EC2:** Nginx·FastAPI 컨테이너를 실행하는 단일 서버. 과제 규모에 맞고 구성이 단순합니다.
- **EBS:** SQLite 게임 기록을 영속적으로 보관합니다.
- **Elastic IP:** 외부에서 접속하는 고정 공인 IP를 제공합니다.
- **Docker Compose:** 웹서버와 API 서버를 분리해 실행하고 재시작을 관리합니다.

외부에는 **80번 포트(HTTP)**만 공개하며, **22번 포트(SSH)**는 관리자 IP로 제한합니다. FastAPI의 **8000번 포트는 내부 통신 전용**입니다.

## 3. 실행 및 배포 방법

**준비 사항:** Git, Docker Engine 및 Docker Compose 플러그인(로컬 macOS에서는 Docker Desktop 사용 가능).

### 로컬 실행

```bash
git clone https://github.com/TTwiVa/AimRabs.git
cd AimRabs
docker compose up -d --build
docker compose ps
curl http://localhost/api/leaderboard
```

- 웹 접속: `http://localhost` (호스트 **80번 포트** 사용)
- 종료: `docker compose down`

### AWS EC2 배포

Ubuntu EC2 생성 후 Elastic IP와 보안 그룹(HTTP 80, 관리자 IP의 SSH 22)을 설정합니다. SSH 접속 후 최초 1회 설치합니다.

```bash
sudo apt update
sudo apt install -y git docker.io docker-compose-v2
sudo usermod -aG docker ubuntu
# 로그아웃 후 다시 SSH 접속
```

이후 저장소를 내려받아 실행합니다.

```bash
git clone https://github.com/TTwiVa/AimRabs.git
cd AimRabs
docker compose up -d --build
docker compose ps
curl http://127.0.0.1/api/leaderboard
```

- **배포 주소:** http://15.164.224.47
- **수정 배포:** `git pull && docker compose up -d --build`
- **데이터 보존:** SQLite는 Docker Named Volume에 저장됩니다. `docker compose down -v`는 저장 데이터를 삭제할 수 있으므로 주의합니다.

## 4. ELB 및 Auto Scaling 확장 검토

현재 AimRabs는 단일 EC2 인스턴스로 운영하며, ELB와 Auto Scaling은 적용하지 않습니다.

게임 진행 중 원의 위치 변경, 클릭 판정, 점수 계산 및 타이머는 사용자 브라우저에서 처리합니다. 서버 API는 주로 게임 시작 시 세션 생성, 종료 시 점수 저장, 랭킹 조회에 사용되므로 게임 진행 중 지속적인 API 요청이 발생하지 않습니다.

따라서 현재 예상되는 이용 규모에서는 단일 EC2로 운영하는 것이 비용과 관리 측면에서 적절하다고 판단합니다.

향후 사용자 증가로 동시 요청이 집중되거나 서버 부하가 높아질 경우, 부하 테스트 결과를 바탕으로 ELB와 Auto Scaling 도입을 검토할 계획입니다. 이때 여러 EC2 인스턴스에서 동일한 데이터를 사용하도록 SQLite를 RDS 등 공용 데이터베이스로 전환하는 방안도 함께 검토합니다.
