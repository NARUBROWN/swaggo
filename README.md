# swaggo

GoSwagger Genie for VS Code. `@Tag(...)` 또는 `#Tag(...)` 형태의 가상 어노테이션을 입력하면, 자동으로 Go Swagger 주석(`// @Tag ...`)으로 변환합니다.

## 핵심 기능

- 가상 어노테이션 문법 지원: `@Summary("...")`, `#Param(...)` 등.
- 자동 변환: 입력 즉시 `// @Tag ...` 형식으로 변환.
- Swagger 주석 렌더링: `// @Tag ...` 주석을 가상 어노테이션 형태로 표시.
- 기본 패턴 진단: `package.Type` 또는 `package.Function` 형태를 정규식으로 검사.
- 스니펫 제공: 자주 쓰는 GET/POST 템플릿.

## 사용 방법

### 1) 입력 예시

```txt
@Summary("클래스 생성")
@Description("클래스 생성 API")
@Tags("classroom", "admin")
@Accept("json")
@Produce("json")
@Param(in="body", name="body", type=dto.CreateClassroomRequest, required=true, desc="클래스 생성 요청")
@Success(code=200, type=dto.ClassroomResponse, desc="클래스 생성 성공")
@Failure(code=400, type=echo.HTTPError, desc="잘못된 요청")
@Router("/classrooms", "post")
```

### 2) 변환 결과

```txt
// @Summary 클래스 생성
// @Description 클래스 생성 API
// @Tags classroom,admin
// @Accept json
// @Produce json
// @Param body body dto.CreateClassroomRequest true "클래스 생성 요청"
// @Success 200 {object} dto.ClassroomResponse "클래스 생성 성공"
// @Failure 400 {object} echo.HTTPError "잘못된 요청"
// @Router /classrooms [post]
```

## 지원하는 어노테이션 문법

아래는 현재 지원하는 가상 어노테이션 태그와 기본 변환 규칙입니다.

### 기본 텍스트 계열

- `@Summary("텍스트")` → `// @Summary 텍스트`
- `@Description("텍스트")` → `// @Description 텍스트`
- `@ID("operationId")` → `// @ID operationId`
- `@Tags("tag1", "tag2")` → `// @Tags tag1,tag2`
- `@Accept("json", "xml")` → `// @Accept json xml`
- `@Produce("json")` → `// @Produce json`
- `@Schemes("http", "https")` → `// @Schemes http https`
- `@Security("ApiKeyAuth")` → `// @Security ApiKeyAuth`
- `@Deprecated()` → `// @Deprecated`

### Param

형식:

```txt
@Param("in", "name", type, required, "description")
```

변환:

```txt
// @Param name in type required "description"
```

예시:

```txt
@Param("query", "id", string, true, "사용자 ID")
```

```txt
// @Param id query string true "사용자 ID"
```

키=값 형태도 지원합니다 (순서 무관):

```txt
@Param(in="query", name="id", type=string, required=true, desc="사용자 ID")
```

### Success / Failure

형식:

```txt
@Success(code, typePath, "description")
@Failure(code, typePath, "description")
```

변환:

```txt
// @Success code {object} typePath "description"
// @Failure code {object} typePath "description"
```

스키마 타입을 직접 지정할 수도 있습니다.

```txt
@Success(200, "array", dto.User, "OK")
```

```txt
// @Success 200 {array} dto.User "OK"
```

지원하는 스키마 타입: `object`, `array`, `string`, `number`, `integer`, `boolean`

키=값 형태:

```txt
@Success(code=200, type=dto.User, desc="OK")
@Success(code=200, schema="array", type=dto.User, desc="OK")
```

### Header

형식:

```txt
@Header(code, type, "name", "description")
```

변환:

```txt
// @Header code {type} name "description"
```

예시:

```txt
@Header(200, string, "Location", "redirect url")
```

```txt
// @Header 200 {string} Location "redirect url"
```

키=값 형태:

```txt
@Header(code=200, type=string, name="Location", desc="redirect url")
```

### Router

형식:

```txt
@Router("/path", "method")
```

변환:

```txt
// @Router /path [method]
```

예시:

```txt
@Router("/classrooms", "post")
```

```txt
// @Router /classrooms [post]
```

키=값 형태:

```txt
@Router(path="/classrooms", method="post")
```

## 어노테이션 파싱 규칙

- `@Tag(...)` 또는 `#Tag(...)` 모두 지원합니다.
- 문자열은 큰따옴표로 감싸는 것을 권장합니다.
- 콤마로 인자를 구분합니다.
- `true/false`, 숫자, 문자열이 혼합되어도 처리합니다.
- `Summary`, `Description`, `ID`, `Param`, `Success/Failure`, `Header`, `Router`는 `key=value` 형식도 지원합니다. (키는 대소문자 무시)
- `description`/`desc` 모두 인식하며 렌더링은 `desc`로 표시됩니다.

## 진단(Diagnostics)

- `package.Type` 또는 `package.Function` 형태를 기본 정규식으로 검사합니다.
- 형식이 맞지 않으면 해당 위치에 경고가 표시됩니다.
- 실제 Go 코드에 해당 타입이 존재하는지는 검사하지 않습니다.

## 스니펫

- `swagpost`: POST용 가상 어노테이션 블록
- `swagget`: GET용 가상 어노테이션 블록

## 개발

1. 의존성 설치: `npm install`
2. 빌드: `npm run compile`
3. 실행: VS Code에서 `F5`로 Extension Development Host 실행

## 비고

- 현재는 입력 즉시 변환됩니다.
- 필요 시 태그별 포맷 규칙을 추가로 확장할 수 있습니다.
- Swagger 주석 렌더링은 에디터에서만 보이며 파일 내용은 변경되지 않습니다.
