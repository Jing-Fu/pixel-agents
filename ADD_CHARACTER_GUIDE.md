# Pixel Agents 新增角色指南

這份文件說明如何在本專案新增可被 Pixel Agents 載入的角色。

## 1. 放置位置與命名規則

把角色圖放到：

`webview-ui/public/assets/characters/`

檔名必須符合：

`char_<N>.png`

範例：

`char_6.png`, `char_7.png`, `char_8.png`

說明：

- `N` 為非負整數。
- 系統會自動掃描所有 `char_*.png`，並依數字大小排序載入。
- 不需要再修改程式碼中的角色數量常數。

## 2. 單一角色圖檔規格

每個 `char_<N>.png` 必須是同一種版型：

- 圖片尺寸：`112 x 96`
- 每格尺寸：`16 x 32`
- 版面：`7` 欄 x `3` 列

欄位語意（由左到右）：

1. `walk_0`
2. `walk_1`
3. `walk_2`
4. `typing_0`
5. `typing_1`
6. `reading_0`
7. `reading_1`

列方向順序（由上到下）：

1. `down`
2. `up`
3. `right`

備註：`left` 方向會由系統自動用 `right` 鏡像產生。

## 3. 新增角色步驟

1. 準備好符合上述規格的 `char_<N>.png`。
2. 存到 `webview-ui/public/assets/characters/`。
3. 確認檔名數字未與現有角色衝突。
4. 重新啟動開發流程（擇一）：
   - 重新載入 Extension Development Host 視窗。
   - 或重新執行建置：`npm run build`

## 4. 如何找下一個可用編號（PowerShell）

在專案根目錄執行：

```powershell
$dir = "webview-ui/public/assets/characters"
$ids = Get-ChildItem $dir -File -Filter "char_*.png" |
  ForEach-Object {
    if ($_.BaseName -match '^char_(\d+)$') { [int]$matches[1] }
  } |
  Sort-Object
$next = if ($ids.Count -eq 0) { 0 } else { ($ids[-1] + 1) }
"next char id: $next"
```

## 5. 常見問題

- 角色沒出現：先檢查檔名是否符合 `char_<N>.png`。
- 角色顯示錯位：先檢查圖片是否為 `112x96`，且每格是 `16x32`。
- 動畫看起來怪異：先檢查欄位順序是否正確（`walk*`、`typing*`、`reading*`）。
