import { createRequire } from "module"
const _require = createRequire(import.meta.url)
const sodium = _require("libsodium-wrappers") as typeof import("libsodium-wrappers")

// Subset of EFF Large Wordlist — replace with full 7776-word list in production
// Full list: https://www.eff.org/files/2016/07/18/eff_large_wordlist.txt
const WORDLIST = [
  "abacus", "abdomen", "abide", "ability", "ablaze", "aboard", "abrupt",
  "absence", "abstract", "abundant", "abyss", "academy", "accept", "acclaim",
  "account", "achieve", "acid", "acquire", "across", "activate", "actual",
  "acute", "adapt", "address", "adequate", "adjust", "admire", "admit",
  "adobe", "adopt", "advance", "adverse", "aerial", "afford", "afraid",
  "after", "agenda", "agile", "agree", "ahead", "airfield", "airline",
  "airport", "album", "alert", "algebra", "alibi", "alien", "align",
  "alley", "almanac", "almost", "aloft", "alone", "alter", "amber",
  "ample", "anchor", "ancient", "angel", "angle", "animal", "anthem",
  "anvil", "apart", "apex", "apple", "apply", "apron", "aqua",
  "archive", "ardent", "area", "argue", "arise", "armada", "around",
  "arrive", "arrow", "artist", "aspect", "aspen", "assign", "atlas",
  "attach", "attic", "audio", "audit", "august", "author", "autumn",
  "avid", "award", "aware", "awful", "babble", "badge", "bakery",
  "ballot", "bamboo", "bandit", "banner", "barely", "barrel", "basin",
  "basket", "battle", "beacon", "beard", "beast", "bellow", "beneath",
  "better", "beyond", "bison", "bitter", "blanket", "blend", "bliss",
  "block", "blood", "bloom", "blossom", "blown", "board", "bonus",
  "border", "botany", "brave", "bridge", "brief", "bright", "broken",
  "bundle", "cabin", "cadet", "candle", "canoe", "canvas", "carbon",
  "cargo", "carpet", "castle", "casual", "cedar", "center", "chain",
  "chance", "change", "chapel", "chart", "chase", "chest", "choice",
  "chorus", "cider", "cipher", "circle", "civic", "civil", "claim",
  "clamp", "clash", "clean", "clear", "cliff", "clock", "cloud",
  "coast", "cobra", "cobalt", "coffee", "comet", "coral", "corner",
  "cotton", "crane", "creek", "crest", "cross", "crowd", "crown",
  "crystal", "curve", "dagger", "dawn", "delta", "dense", "depth",
  "desert", "detail", "device", "drift", "dusk", "eagle", "earth",
  "echo", "ember", "empty", "epoch", "equal", "error", "event",
]

export async function generateCodename(): Promise<string> {
  await sodium.ready
  const words: string[] = []
  for (let i = 0; i < 3; i++) {
    const buf = sodium.randombytes_buf(4)
    // Handle both regular ArrayBuffer and potential offsets in the buffer
    const index = (Buffer.from(buf).readUInt32BE(0) >>> 0) % WORDLIST.length
    words.push(WORDLIST[index])
  }
  return words.join("-")
}
