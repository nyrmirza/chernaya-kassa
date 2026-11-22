# Черная касса — iOS

Касса по очереди для компании: жеребьёвка месяцев, сбор на встрече, тихие долги на Kaspi.
Стек как у «Тайного Санты»: Expo (React Native) + Supabase, вход без регистрации (анонимный), касса по 6-значному коду.

## Что внутри

```
app/                 экраны (expo-router)
  index.tsx          мои кассы, «Создать» / «Войти по коду»
  create.tsx         новая касса → вы организатор
  join/index.tsx     ввод кода
  join/[code].tsx    превью кассы и вход (новое место / место супруга / место «без приложения»)
  kassa/[id].tsx     касса: вкладки Встреча · Очередь · Участники
  settings.tsx       язык KZ/RU/EN, удаление данных
src/lib/api.ts       все вызовы сервера (RPC)
src/lib/texts.ts     тексты для WhatsApp: очередь для описания группы, приглашение, встреча
src/i18n/strings.ts  переводы kk / ru / en
supabase/migrations  схема БД и серверные функции
```

Deep link на вход: `chernayakassa://join/KZ7D3Q` открывает экран входа с подставленным кодом.

## Сервер (Supabase)

Проект **chernaya-kassa** (`pintazpikeeuwfofdrlt`, Frankfurt). Миграция `0001_init.sql` уже применена.

**Один шаг вручную:** Supabase → Authentication → Sign In / Providers → включить **Allow anonymous sign-ins**.
Без этого приложение покажет «Нет связи с сервером» на старте.

Как устроена приватность: клиент не читает таблицы напрямую (RLS включён, прав нет), всё идёт через функции.
`get_kassa()` отдаёт способ оплаты («Нал» / «Kaspi позже») только хозяину кассы этого месяца и самому плательщику,
остальным — просто «сдал». Проверено на 4 тестовых пользователях.

Если у хозяина месяца нет приложения (место добавлено вручную), сбор отмечает организатор.

## Запуск

```bash
npm install
npx expo install --fix      # выровнять версии под текущий Expo SDK
npx expo prebuild -p ios    # нужен из-за datetimepicker и шрифтов
npx expo run:ios            # симулятор / подключённый iPhone
```

Сборка для App Store:

```bash
npx eas-cli build -p ios --profile production
npx eas-cli submit -p ios
```

Bundle ID: `kz.nurbakyt.chernayakassa` (поменяйте в `app.json`, если нужен другой).

## Перед релизом

- Когда приложение появится в App Store, впишите ссылку в `web/j.html` (`APP_STORE_URL`) — см. раздел про ссылку-приглашение.
- Политика конфиденциальности для App Store: приложение хранит имена участников, суммы взносов и даты встреч, без телефонов и email.
- Пуш-уведомления пока не подключены (в Тайном Санте они идут через Expo Push — можно перенести тем же способом).

## Ссылка-приглашение (Universal Links)

В приглашении ссылка `https://chernaya-kassa-kz.web.app/j/КОД` (для супруга — `/p/КОД`):
- приложение установлено → iOS сразу открывает экран входа в кассу с подставленным кодом;
- приложения нет → открывается страница с кодом, кнопкой «Скопировать» и App Store.

Страница лежит в папке `web/` и публикуется на Firebase Hosting в том же проекте, что и Тайный Санта
(`secret-santa-1c7e3`), отдельным сайтом `chernaya-kassa-kz`:

```cmd
firebase hosting:sites:create chernaya-kassa-kz
firebase deploy --only hosting:kassa
```

`/.well-known/apple-app-site-association` содержит Team ID `9PQF683C2B` и `kz.nurbakyt.chernayakassa`.
Когда приложение появится в App Store, впишите ссылку в `web/j.html` (`APP_STORE_URL`) и снова сделайте deploy.
Universal Links работают только в настоящей сборке (TestFlight / App Store), не в Expo Go.

## Android

Пакет: `kz.nurbakyt.chernayakassa` (как на iOS). Сервер, переводы и логика общие — отличия только в мелочах:
дата и время встречи выбираются в системном диалоге, шрифт — системный Roboto (с казахскими буквами),
напоминания идут через канал «Встречи / Кездесулер».

Проверить без сборки: на Android-телефоне установите **Expo Go** из Google Play и отсканируйте QR из `npx expo start --tunnel`.

Сборка APK для установки на телефон (без Google Play):

```cmd
cd C:\chernaya-kassa-app
set EAS_NO_VCS=1
npx eas-cli build -p android --profile preview
```

При первой сборке EAS спросит про новый проект и ключ подписи — отвечайте «Yes» (ключ создаст и сохранит EAS).
Firebase / google-services.json не нужны: напоминания локальные, без push-сервера.

Для Google Play (нужен аккаунт разработчика Play Console, разовый взнос $25):

```cmd
npx eas-cli build -p android --profile production
npx eas-cli submit -p android
```

### Ссылки-приглашения на Android (App Links)

После первой сборки выполните `npx eas-cli credentials -p android` → скопируйте **SHA-256 Fingerprint**
и впишите его в `web/.well-known/assetlinks.json` вместо `SHA256_ИЗ_EAS_CREDENTIALS`, затем:

```cmd
firebase deploy --only hosting:kassa
```

Когда приложение появится в Google Play, впишите ссылку в `web/j.html` (`PLAY_URL`) и снова сделайте deploy.
