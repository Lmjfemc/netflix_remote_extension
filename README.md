# Netflix LAN Remote

**휴대폰을 PC Netflix 전용 리모컨으로.**

소파에서 휴대폰 브라우저로 콘텐츠를 고르고, PC의 Netflix를 재생·탐색·제어하는 로컬 네트워크 프로토타입입니다. PC에는 Chrome 확장프로그램과 작은 Go 보조 프로그램을 설치하고, 휴대폰은 QR 코드를 스캔하면 됩니다.

**계정 가입 없음 · 모바일 앱 설치 없음 · 외부 연결 서버 없음 · 영상 전송 없음**

[최신 릴리스 다운로드](https://github.com/Lmjfemc/netflix_remote_extension/releases/latest) · [변경 기록](CHANGELOG.md) · [검증 결과](VALIDATION.md)

> Windows x64 + Chrome/Chromium을 대상으로 합니다. Netflix는 기존에 로그인된 PC 브라우저에서 재생됩니다. 이 프로젝트는 Netflix의 공식 제품이 아닙니다.

## 무엇을 할 수 있나요?

| 기능 | 동작 |
| --- | --- |
| 콘텐츠 탐색·선택 | PC Netflix 화면의 콘텐츠 카드를 휴대폰에 표시하고 선택한 작품을 PC에서 재생 |
| 검색 | 휴대폰에서 검색어를 입력해 PC Netflix 검색 화면 열기 |
| 재생 상태 동기화 | 작품·에피소드 제목, 재생 위치, 길이, 재생/일시정지 상태 표시 |
| 재생·일시정지 | 휴대폰 버튼으로 PC 플레이어 제어 |
| ±10초·스크러빙 | 연속 탭을 누적하고 타임라인으로 원하는 위치 탐색 |
| 음량·음소거 | Netflix 플레이어 음량과 음소거 제어 |
| 전체 화면 | Chrome 창의 전체 화면을 켜고 이전 창 상태로 복원 |
| 인트로 건너뛰기 | Netflix가 제공할 때 수동 또는 자동으로 실행 |
| 줄거리 건너뛰기 | 별도 버튼 제공, Netflix에서 사용 가능할 때 활성화 |
| 다음 에피소드 | 플레이어에서 제공하는 다음 화로 이동 |
| 서버 켜기·끄기 | 확장프로그램에서 Go 보조 서버의 실행과 종료 관리 |

광고 중 탐색·건너뛰기는 비활성화됩니다. 줄거리는 자동으로 건너뛰지 않습니다. 탐색·검색은 **PC의 Netflix 탭 자체를 이동**하므로 진행 중인 재생이 중단됩니다.

## 구조

```mermaid
flowchart LR
    Phone[휴대폰 웹 리모컨] <-->|LAN HTTP / WebSocket| Host[Go EXE]
    Host <-->|Native Messaging| Extension[Chrome 확장프로그램]
    Extension <-->|플레이어 상태와 명령| Netflix[로그인된 Netflix 탭]
```

Go EXE 안에 휴대폰 웹페이지가 포함되어 있습니다. 외부 웹 호스팅, 시그널링 서버, Node 런타임 없이 동작합니다. 영상과 오디오는 PC에서만 재생하고, 휴대폰에는 제어 메시지와 메타데이터만 전달합니다.

## 빠른 시작

### 1. 배포 파일 받기

[Releases](https://github.com/Lmjfemc/netflix_remote_extension/releases)에서 최신 Windows x64 전체 ZIP을 내려받아 압축을 **모두** 풉니다. v0.2.1 파일명은 `netflix-lan-remote-v0.2.1-windows-amd64.zip`입니다.

`install.cmd`, `uninstall.cmd`, `native-host.json`, `dist/netflix-remote.exe`, `extension/`이 함께 있어야 합니다. 사용자는 **Go·Node·PowerShell을 설치하거나 실행할 필요가 없습니다.**

### 2. install.cmd 더블클릭 — 최초 설치 및 업데이트

리모컨이 실행 중이면 먼저 확장 팝업의 **끄기**를 누릅니다. 압축을 푼 폴더의 **install.cmd**를 더블클릭하고 성공 메시지를 확인합니다. 일반 사용자 권한으로 실행하세요.

설치 파일은 다음 위치에 복사됩니다.

`%LOCALAPPDATA%\NetflixRemote`

현재 사용자 계정의 Chrome Native Messaging 등록을 추가합니다. 확장 ID는 고정되어 **복사·입력할 필요가 없습니다.** 다운로드 폴더를 옮기거나 삭제해도 설치된 프로그램은 유지됩니다. PowerShell 실행 정책, 방화벽, 네트워크 분류는 변경하지 않습니다.

### 3. 설치된 확장프로그램 로드

1. Chrome에서 `chrome://extensions`를 엽니다.
2. **개발자 모드**를 켜고 **압축해제된 확장 프로그램을 로드합니다**를 선택합니다.
3. 폴더 선택창 주소에 `%LOCALAPPDATA%\NetflixRemote\extension`을 입력하고 해당 폴더를 선택합니다.

**v0.2.0에서 이전:** 기존 확장에서 리모컨을 끄고, 기존 확장을 제거한 뒤 위 폴더를 로드하세요. 고정 ID 적용으로 ID가 한 번 바뀌며 기존 확장 설정은 자동 이전되지 않습니다. 이전 프로젝트 폴더는 자동 삭제하지 않습니다.

**v0.2.1 이후 업데이트:** 새 ZIP을 풀고 install.cmd를 다시 실행한 뒤 Chrome 확장 카드의 새로고침과 Netflix 탭 새로고침을 수행합니다. 다운로드 폴더의 extension을 따로 로드하지 마세요.

고정 ID는 `kpklnbjdnjbkficgfkjnodofpganejpf`입니다. manifest의 공개키는 unpacked ID를 유지하기 위한 것으로 코드 서명이나 보안 인증이 아닙니다. Chrome Web Store 게시 시에는 게시본 ID와 호스트 허용 목록을 함께 검토해야 합니다. 제공 설치 파일은 **Google Chrome용**이며 다른 Chromium 브라우저에는 별도 등록이 필요합니다.

### 4. 리모컨 켜고 휴대폰 연결

1. Chrome에서 Netflix에 로그인하고 탭을 엽니다. 확장 설치·업데이트 후에는 Netflix 탭을 새로고침합니다.
2. 확장 팝업에서 **리모컨 켜기**를 누릅니다.
3. 휴대폰을 같은 Wi-Fi/LAN에 연결하고 QR을 스캔합니다.
4. 또는 표시된 LAN 주소를 열고 6자리 코드를 입력합니다.
5. 휴대폰 화면에 **PC connected**가 표시되면 제어할 수 있습니다.

PC의 `http://localhost:8787/pc`에서도 QR을 확인할 수 있습니다. 여러 주소가 나오면 실제 Wi-Fi/이더넷 주소를 사용하세요. VPN·가상 어댑터 주소는 휴대폰에서 접근할 수 없을 수 있습니다.

### 5. 종료·재연결

확장 팝업의 **끄기**를 누르면 서버를 종료합니다. 팝업만 닫으면 서버는 계속 실행됩니다. Chrome과의 Native Messaging 연결이 종료되어도 서버가 종료됩니다. Chrome의 백그라운드 실행 설정에 따라 마지막 창을 닫아도 프로세스가 남을 수 있으므로 명시적 종료에는 **끄기**를 사용하세요.

현재 버전은 서버를 다시 켤 때 코드와 세션 토큰을 새로 만듭니다. **재시작 후에는 새 QR/코드로 다시 페어링**해야 합니다. 한 번에 휴대폰 한 세션을 지원하며 새 연결이 기존 연결을 대체합니다.

## 휴대폰이 접속되지 않을 때

- PC와 휴대폰이 같은 네트워크인지 확인합니다. 게스트 Wi-Fi의 기기 간 격리가 켜져 있으면 연결할 수 없습니다.
- `localhost`는 PC 전용입니다. 휴대폰에는 팝업에 표시된 PC의 LAN 주소를 입력합니다.
- Windows 방화벽에서 EXE의 TCP 8787 접속이 허용되어야 합니다.
- 신뢰하는 **Private 네트워크**에서는 관리자 PowerShell에서 `./allow-lan.ps1`을 실행할 수 있습니다. 이 EXE, TCP 8787, LocalSubnet, Private 프로필에 한정된 규칙을 추가합니다.
- 네트워크가 **Public**이면 위 스크립트는 접속을 허용하지 않습니다. 네트워크 환경에 맞는 정책을 직접 확인하세요. 스크립트가 네트워크 분류를 바꾸거나 방화벽을 끄지는 않습니다.
- 포트가 사용 중이면 다른 서버를 종료하고 다시 켭니다. 기존 Node 프로토타입과 Go 서버를 동시에 8787 포트에서 실행할 수 없습니다.
- `Specified native messaging host not found`는 install.cmd를 다시 실행하고 설치된 확장 폴더와 EXE 존재 여부를 확인합니다.
- 확장을 새로고침한 뒤 연결이 안 되면 Netflix 탭도 새로고침합니다.

## 개발·빌드

Go **1.24 이상**, Windows x64가 필요합니다. JavaScript 테스트와 포맷 작업에는 Node **20 이상**을 사용합니다. 릴리스 EXE는 Go 1.27.1로 빌드했습니다.

```powershell
# Go 테스트·정적 검사·EXE 빌드
./build.ps1

# JS 및 실제 EXE 통합 테스트
npm ci
npm test

# 코드 포맷 검사
npm run format:check

# 테스트 후 배포 ZIP·EXE·체크섬 생성
./package-release.ps1
```

`build.ps1`은 PATH의 Go 또는 `.tools/go/bin/go.exe`를 사용합니다. `-trimpath`, 심볼 제거, Windows GUI 서브시스템 설정으로 콘솔 창 없는 EXE를 생성합니다. 로컬 서버가 실행 중이어도 릴리스 빌드는 별도 출력 폴더를 사용합니다.

Go 소스에서 `public/*`을 `go:embed`로 포함하므로 웹 UI를 수정하면 EXE도 다시 빌드해야 합니다. Netflix 어댑터 수정은 확장 재로드와 Netflix 탭 새로고침으로 적용합니다.

### 소스 구성

```text
main.go / main_test.go       Go 서버·Native Messaging·테스트
 go.mod / go.sum             Go 의존성 버전
extension/
  netflix-adapter.js         Netflix 플레이어·DOM·탐색·건너뛰기 로직
  content.js                 Netflix 페이지와 확장 간 연결
  background.js              보조 서버 생명주기·명령 전달·전체 화면
  popup.*                    서버 켜기/끄기·페어링 UI
public/                      EXE에 내장되는 휴대폰·PC 웹페이지
test/                        JS 어댑터·빌드 EXE 통합 테스트
legacy/                      이전 Node 서버 참고 구현
build.ps1                    Go 빌드 및 검사
package-release.ps1          릴리스 패키지와 SHA-256 생성
```

Netflix 전용 로직은 네트워크 및 UI와 분리되어 있습니다. `legacy/`는 이전 구현 기록이며 현재 확장프로그램의 실행 경로에 포함되지 않습니다.

## 검증 범위와 제한

실제 로그인된 Netflix에서 콘텐츠 선택, 재생·일시정지, 탐색, 음소거와 상태 동기화를 확인했습니다. Go 버전에서 연속 +10초 세 번이 실제 플레이어에서 +30.003초 이동했고, 슬라이더 탐색도 확인했습니다. 자세한 내용은 [VALIDATION.md](VALIDATION.md)를 참고하세요.

- **물리적 iOS/Android 기기와 별도 Wi-Fi 기기에서의 접속 검증은 아직 완료되지 않았습니다.** 브라우저 모바일 뷰포트와 PC의 LAN 주소를 사용해 검증했습니다.
- 실제 줄거리 건너뛰기는 해당 구간이 제공될 때 추가 검증이 필요합니다. 버튼·명령 전달·광고 차단 조건은 테스트했습니다.
- Netflix의 공식 리모컨 API가 아닌 내부 플레이어와 DOM을 사용하므로 Netflix 변경 시 수정이 필요할 수 있습니다.
- 카탈로그는 PC 페이지에 로드된 카드 기준이며 Netflix 전체 카탈로그 API를 제공하지 않습니다.
- LAN HTTP/WebSocket은 암호화되지 않습니다. 신뢰하는 로컬 네트워크용이며 인터넷 포트 포워딩은 사용하지 마세요.
- HTTP 기반 모바일 웹입니다. 완전한 오프라인·설치형 PWA를 보장하지 않습니다.
- Windows EXE는 코드 서명되지 않은 프로토타입입니다. CMD 설치는 PowerShell 실행 정책 의존성만 없앱니다. 다운로드 경고, SmartScreen, Smart App Control 또는 조직 정책으로 실행이 제한될 수 있습니다. 보안 설정을 자동으로 해제하지 않습니다.

네트워크 소스 주소·Host·Origin을 검사하고, 페어링 시도 제한과 임의의 세션 토큰을 사용합니다. Netflix 자격증명을 수집하거나 별도 로그인하지 않습니다. 외부 연결 서버나 시청 기록 저장소도 없습니다.

## 제거

리모컨을 끄고 Chrome에서 확장프로그램을 제거한 뒤, 배포 ZIP 또는 `%LOCALAPPDATA%\NetflixRemote`의 `uninstall.cmd`를 실행하세요. 설치된 EXE·확장 파일과 이 설치 경로를 가리키는 Native Messaging 등록을 제거합니다. 관련 없는 파일과 다른 경로를 가리키는 등록은 보존합니다. 창을 닫은 뒤 남은 제거 스크립트와 폴더는 직접 삭제할 수 있습니다. 선택적 방화벽 규칙을 추가했다면 관리자 PowerShell에서 다음 명령으로 제거합니다.

```powershell
Remove-NetFirewallRule -Name NetflixLANRemote-Go
```

## 라이선스

프로젝트는 [ISC](LICENSE) 라이선스입니다. 배포 EXE에 포함된 Go 런타임과 라이브러리의 고지는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다. Netflix 명칭은 해당 권리자의 상표이며, 본 프로젝트는 Netflix와 제휴하거나 승인받지 않았습니다.
