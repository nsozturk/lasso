# bana youtubedaki bir kanalın tüm videolarını indirebileceğim.bir arayüz tasarla.

**Date:** 2026-05-07
**Topic:** youtubedaki kanalın tüm videolarını indirebileceği
**Source:** Auto-saved by Claude Code Stop hook

## Research Request

bana youtubedaki bir kanalın tüm videolarını indirebileceğim.bir arayüz tasarla.githubu araştır sence web mi olmalı native mi olmalı.

## Findings

Apple-vari, açık tema, abonelik + oto-arşiv odaklı bir uygulamanın iskeletini çıkarıyorum. Native macOS / Tauri penceresi varsayımıyla.

## Ürün konsepti — "Lasso"

Tek cümlelik konum: *Bir kanalı bir kez ekle, gerisini Lasso halletsin — yeni video çıktıkça arşivine düşsün.*

Apple Mail / Music / Reminders'taki **3-bölge** kalıbı (sidebar · liste · detay) ama YouTube/podcatcher mantığıyla.

---

## 1. Ana pencere — kanal detay görünümü

```
╭─ ●  ●  ●  ──────────────────────────────────────────────────────────────────────╮
│  ⊕  Add Channel                  🔍  Search videos…             ⏱  Activity  ⚙  │
├──────────────────┬──────────────────────────────────────────────────────────────┤
│                  │                                                              │
│  LIBRARY         │   ╭──────────────────────────────────────────────────────╮   │
│  ▸  All Videos   │   │  ⬤ avatar    Veritasium                              │   │
│      1 248       │   │              @veritasium · 14.8M subs                │   │
│  ▸  Recently     │   │              ┌──────────────┐  ┌────────────────┐    │   │
│      Added       │   │              │ Auto-archive │  │ ↻ Sync now     │    │   │
│  ▸  Continue     │   │              │   ●━━○       │  └────────────────┘    │   │
│      Watching    │   │                                                       │   │
│  ▸  Downloads    │   │   312 videos · 41.2 GB · last sync 6 min ago          │   │
│      4 active    │   ╰──────────────────────────────────────────────────────╯   │
│                  │                                                              │
│  CHANNELS    ⊕   │   ▾ Filters    All · Saved · New · Shorts off               │
│  ⬤  Veritasium   │                                                              │
│  ⬤  Kurzgesagt 2 │   ┌──────────────┬─────────────────────────────────────────┐ │
│  ⬤  3Blue1Brown  │   │              │  How One Line in the Oldest Math Text…  │ │
│  ⬤  Fireship  •  │   │  [thumb]     │  17:24  ·  posted 2 days ago            │ │
│  ⬤  Tom Scott    │   │              │  ✓ Downloaded  ·  1080p  ·  486 MB      │ │
│                  │   └──────────────┴─────────────────────────────────────────┘ │
│  ─────────────   │   ┌──────────────┬─────────────────────────────────────────┐ │
│  PLAYLISTS  ⊕    │   │              │  The Strangest Numbers in String Theory │ │
│  ★  Watch Later  │   │  [thumb]  NEW│  22:11  ·  posted today                 │ │
│  📚 Math archive │   │              │  ⤓ Queued  ·  Auto · 1080p              │ │
│                  │   └──────────────┴─────────────────────────────────────────┘ │
│                  │   ┌──────────────┬─────────────────────────────────────────┐ │
│  ─────────────   │   │              │  Why Gravity Is NOT a Force             │ │
│  💾 41.2 GB used │   │  [thumb]     │  14:08  ·  posted 1 mo ago              │ │
│  on Macintosh HD │   │              │  ◌ Skip (Short blocked by rule)         │ │
│                  │   └──────────────┴─────────────────────────────────────────┘ │
╰──────────────────┴──────────────────────────────────────────────────────────────╯
```

Notlar:
- **Sidebar #F5F5F7**, sağ panel saf beyaz — macOS Mail'deki ayrım.
- Kanal satırındaki yanan **rakam (Kurzgesagt 2)** = bekleyen yeni video; Mail'deki unread badge gibi.
- **Auto-archive toggle**'ı kanal kartının içine koyduk — bu uygulamanın asıl differentiator'ü; üstte cesur durması lazım.
- Video kartlarında **durum chip'i** tek tek: `✓ Downloaded`, `⤓ Queued`, `◌ Skip`, `⏸ Paused`. Renkler: yeşil / mavi / nötr gri / amber.

---

## 2. Kanal ekleme — ortada çıkan sheet

```
        ╭────────────────────────────────────────────────────────────╮
        │                                                            │
        │              Add a channel to your library                 │
        │                                                            │
        │     ┌──────────────────────────────────────────────────┐   │
        │     │  https://youtube.com/@veritasium                 │   │
        │     └──────────────────────────────────────────────────┘   │
        │                                                            │
        │     ╭─ preview ──────────────────────────────────────╮     │
        │     │  ⬤  Veritasium                                 │     │
        │     │      14.8M subscribers · 312 videos            │     │
        │     ╰────────────────────────────────────────────────╯     │
        │                                                            │
        │     What should we grab?                                   │
        │     ◉  From now on (only new uploads)                      │
        │     ○  Last  [ 25 ▾ ]  videos and forward                  │
        │     ○  The full back catalog (~41 GB)                      │
        │                                                            │
        │     Quality                                                │
        │     [ 1080p ▾ ]   [ MP4 ▾ ]   ☑ Skip Shorts                │
        │                                                            │
        │     Save to                                                │
        │     ~/Movies/Lasso/Veritasium/    [ Change… ]              │
        │                                                            │
        │                  ┌──────────┐  ┌──────────────────┐        │
        │                  │  Cancel  │  │  Add channel  ↵  │        │
        │                  └──────────┘  └──────────────────┘        │
        │                                                            │
        ╰────────────────────────────────────────────────────────────╯
```

Tek ekran, sürtüşmesiz. **"From now on"** default — kullanıcı 41 GB'lık bir geri arşivi yanlışlıkla başlatmasın.

---

## 3. Activity panel — sağdan kayan inspector

```
                                          ╭──────────────────────────────╮
                                          │  Activity            ✕       │
                                          │                              │
                                          │  ▾ NOW                       │
                                          │  ╭─────────────────────────╮ │
                                          │  │ Strangest Numbers in S… │ │
                                          │  │ Veritasium · 1080p      │ │
                                          │  │ ▰▰▰▰▰▰▱▱▱▱  62 %        │ │
                                          │  │ 3.2 MB/s · 1m 14s left  │ │
                                          │  ╰─────────────────────────╯ │
                                          │                              │
                                          │  ▾ UP NEXT (3)               │
                                          │  •  Kurzgesagt — Black Holes │
                                          │  •  Fireship — Bun 2.0 in 1… │
                                          │  •  3Blue1Brown — Linear …   │
                                          │                              │
                                          │  ▾ COMPLETED · TODAY         │
                                          │  ✓  Tom Scott — Things…      │
                                          │  ✓  Veritasium — Why Grav…   │
                                          │                              │
                                          │  ────────────────────────    │
                                          │  ↻ Next sync in 23 min       │
                                          │                              │
                                          ╰──────────────────────────────╯
```

Tek panel = aktif + kuyruk + bugün biten + sıradaki sync. Ayrı sayfa açmaktansa drawer; Apple'ın Reminders/Notes inspector kalıbı.

---

## Tasarım tokenları (Apple-vari, açık tema)

| Token | Değer | Notu |
|---|---|---|
| `bg.app` | `#FFFFFF` | Ana içerik |
| `bg.sidebar` | `#F5F5F7` | Sol panel |
| `bg.elevated` | `#FBFBFD` | Kartlar, sheet |
| `border.hairline` | `#E5E5EA` (1 px) | Liste ayraçları |
| `text.primary` | `#1D1D1F` | Apple siyahı |
| `text.secondary` | `#6E6E73` | Meta bilgi |
| `accent` | `#0071E3` | Apple mavisi (CTA, link) |
| `success` | `#34C759` | İndirildi |
| `warning` | `#FF9F0A` | Skip / Paused |
| `danger` | `#FF3B30` | Hata |
| Radius | 10px (control), 14px (card), 18px (sheet) | |
| Tipografi | SF Pro Display 28/22/17/13 | Tauri'de Inter fallback |
| Gölge | `0 1px 2px rgba(0,0,0,.04), 0 8px 24px rgba(0,0,0,.06)` | Sadece kart/sheet |
| Hareket | 200 ms ease-out (sidebar nav), 320 ms (sheet açılış) | |

---

## Üzerinde durmaya değer 3 seçim

1. **Auto-archive toggle'ı kanal kartında değil, kanal listesindeki ikon** olabilir mi? Şu an üstte ama kullanıcı 20 kanalını yönetirken liste içinden açıp kapamak isteyecektir. Önerim: ikisi de — listede mini toggle, kart başlığında onay/sürtüşmesi olan tam kontrol.
2. **"Continue Watching" sidebar'da ne işe yarıyor?** Eğer uygulama içi oynatıcı eklemeyeceksek (yt-dlp + `mpv` shellouT yeterli) bu satırı atalım, scope sızar.
3. **Shorts default davranışı**: araştırmadaki tool'lar Shorts'u karıştırıyor. Default `Skip Shorts ON` öneririm — geri arşiv 41 GB yerine 18 GB olur, kullanıcı isterse açar.

---

Sıradaki adım için iki yol var:
- **A)** Bu wireframe'i Tauri+SwiftUI-vari HTML/CSS prototipine döküp `prototype/` klasörüne koyayım (tıklanabilir, `tmp/design/` değil kalıcı).
- **B)** Önce isim ("Lasso" placeholder), ikon yönü, ve yukarıdaki 3 seçim üzerinde anlaşalım, sonra prototip.

Hangisi?
