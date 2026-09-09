import { canvasTapePatternSchema, type CanvasTapeIconId, type CanvasTapePattern } from "@/domain/model"

export const TAPE_BACKGROUND_COLORS = [
  "#e9b982",
  "#b8d0c0",
  "#e6b1c0",
  "#aec6dc",
  "#d6c58e",
] as const

export const CANVAS_TAPE_ICON_COLORS = [
  "#5b4332",
  "#2f5e4f",
  "#7a4350",
  "#3f5f7a",
  "#6e5b2d",
  "#6c4c7f",
] as const

export type TapePatternCategory = "all" | "people" | "nature" | "food" | "activity" | "travel" | "objects" | "symbols"

export const TAPE_PATTERN_CATEGORIES: ReadonlyArray<{ id: TapePatternCategory; label: string; keywords: readonly string[] }> = [
  { id: "all", label: "全部", keywords: ["all", "全部"] },
  { id: "people", label: "表情", keywords: ["people", "face", "表情", "人物"] },
  { id: "nature", label: "自然", keywords: ["nature", "weather", "自然", "天气"] },
  { id: "food", label: "食物", keywords: ["food", "drink", "食物", "饮料"] },
  { id: "activity", label: "活动", keywords: ["activity", "sport", "activity", "活动", "运动"] },
  { id: "travel", label: "旅行", keywords: ["travel", "place", "旅行", "地点"] },
  { id: "objects", label: "物品", keywords: ["objects", "thing", "物品", "工具"] },
  { id: "symbols", label: "符号", keywords: ["symbols", "symbol", "符号", "标记"] },
]

export type TapeIconNode =
  | ({ type: "path"; d: string } & TapeIconNodeStyle)
  | ({ type: "circle"; cx: number; cy: number; r: number } & TapeIconNodeStyle)
  | ({ type: "line"; x1: number; y1: number; x2: number; y2: number } & TapeIconNodeStyle)
  | ({ type: "polyline"; points: string } & TapeIconNodeStyle)
  | ({ type: "polygon"; points: string } & TapeIconNodeStyle)
  | ({ type: "rect"; x: number; y: number; width: number; height: number; rx?: number; ry?: number } & TapeIconNodeStyle)

export interface TapeIconNodeStyle {
  fill?: string
  stroke?: string
  strokeWidth?: number
  strokeLinecap?: "butt" | "round" | "square"
  strokeLinejoin?: "miter" | "round" | "bevel"
  fillRule?: "nonzero" | "evenodd"
  clipRule?: "nonzero" | "evenodd"
  opacity?: number
}

export interface TapeIconDefinition {
  id: CanvasTapeIconId
  label: string
  category: Exclude<TapePatternCategory, "all">
  keywords: readonly string[]
  nodes: readonly TapeIconNode[]
}

export interface TapeEmojiEntry {
  value: string
  label: string
  category: Exclude<TapePatternCategory, "all">
  keywords: readonly string[]
}

const lineStyle: TapeIconNodeStyle = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" }
const fillStyle: TapeIconNodeStyle = { fill: "currentColor" }
const path = (d: string, style: TapeIconNodeStyle = lineStyle): TapeIconNode => ({ type: "path", d, ...style })
const circle = (cx: number, cy: number, r: number, style: TapeIconNodeStyle = lineStyle): TapeIconNode => ({ type: "circle", cx, cy, r, ...style })
const line = (x1: number, y1: number, x2: number, y2: number, style: TapeIconNodeStyle = lineStyle): TapeIconNode => ({ type: "line", x1, y1, x2, y2, ...style })
const rect = (x: number, y: number, width: number, height: number, options: { rx?: number; ry?: number; style?: TapeIconNodeStyle } = {}): TapeIconNode => ({ type: "rect", x, y, width, height, ...options, ...options.style })
const polyline = (points: string, style: TapeIconNodeStyle = lineStyle): TapeIconNode => ({ type: "polyline", points, ...style })
const polygon = (points: string, style: TapeIconNodeStyle = lineStyle): TapeIconNode => ({ type: "polygon", points, ...style })

const icon = (
  id: CanvasIconId,
  label: string,
  category: Exclude<TapePatternCategory, "all">,
  keywords: readonly string[],
  nodes: readonly TapeIconNode[],
): TapeIconDefinition => ({ id, label, category, keywords, nodes })

type CanvasIconId = CanvasTapeIconId

export const TAPE_ICON_ENTRIES: readonly TapeIconDefinition[] = [
  icon("sparkles", "闪光", "symbols", ["sparkles", "magic", "闪光", "魔法"], [
    path("m12 3-1.2 4.2L7 8.4l3.8 1.2L12 14l1.2-4.4L17 8.4l-3.8-1.2Z"),
    path("m19 14-.7 2.3L16 17l2.3.7L19 20l.7-2.3L22 17l-2.3-.7Z"),
  ]),
  icon("heart", "心", "people", ["heart", "love", "心", "喜欢"], [path("M20.8 8.8c0 5.3-8.8 10-8.8 10S3.2 14.1 3.2 8.8A4.6 4.6 0 0 1 12 6.2a4.6 4.6 0 0 1 8.8 2.6Z")]),
  icon("star", "星星", "symbols", ["star", "favorite", "星星", "收藏"], [polygon("12 2.8 14.8 8.5 21.1 9.4 16.5 13.8 17.6 20 12 17.1 6.4 20 7.5 13.8 2.9 9.4 9.2 8.5", lineStyle)]),
  icon("sun", "太阳", "nature", ["sun", "light", "太阳", "阳光"], [circle(12, 12, 4), line(12, 2, 12, 5), line(12, 19, 12, 22), line(2, 12, 5, 12), line(19, 12, 22, 12), line(4.9, 4.9, 7, 7), line(17, 17, 19.1, 19.1), line(19.1, 4.9, 17, 7), line(7, 17, 4.9, 19.1)]),
  icon("moon", "月亮", "nature", ["moon", "night", "月亮", "夜晚"], [path("M20.5 14.4A8.5 8.5 0 0 1 9.6 3.5 8.5 8.5 0 1 0 20.5 14.4Z")]),
  icon("cloud", "云朵", "nature", ["cloud", "weather", "云", "天气"], [path("M7 18h10.5a3.5 3.5 0 0 0 .3-7 5.5 5.5 0 0 0-10.6-1A4 4 0 0 0 7 18Z")]),
  icon("leaf", "叶子", "nature", ["leaf", "plant", "叶子", "植物"], [path("M20 4C10.6 4.3 5.2 7.8 5.2 13.2A4.8 4.8 0 0 0 10 18c5.5 0 9.8-5.5 10-14Z"), path("M4 20c3.2-4.7 6.6-7.8 11.2-10.2")]),
  icon("flower-2", "花朵", "nature", ["flower", "bloom", "花", "花朵"], [circle(12, 12, 2.3), circle(12, 5.8, 3), circle(17.4, 9, 3), circle(15.3, 15.3, 3), circle(8.7, 15.3, 3), circle(6.6, 9, 3)]),
  icon("apple", "苹果", "food", ["apple", "fruit", "苹果", "水果"], [path("M12 7.1c-1.3-2.8-4.7-2.4-4.7.1C3 8.4 4.1 16.9 9 19.5c1.4.8 2.1-.2 3-.2s1.6 1 3 .2c4.9-2.6 6-11.1 1.7-12.3 0-2.5-3.4-2.9-4.7-.1Z"), path("M12 5.7c.2-1.7 1.1-2.7 2.7-3.2")]),
  icon("cherry", "樱桃", "food", ["cherry", "fruit", "樱桃", "水果"], [circle(8, 16, 3.2, fillStyle), circle(16, 16, 3.2, fillStyle), path("M8 13C8.4 7 10.5 4.8 12 3M16 13c-.5-5.1-2.2-7.8-4-10M12 5c2.5-1.5 4.4-1.3 5.5-.4")]),
  icon("carrot", "胡萝卜", "food", ["carrot", "vegetable", "胡萝卜", "蔬菜"], [path("m9 11 7 7-3.5 3.5a2 2 0 0 1-2.8 0l-4.2-4.2a2 2 0 0 1 0-2.8Z"), path("m15 12 4-4M17 8l-1-3M19 8l2-1M15 9l-3-2")]),
  icon("cake-slice", "蛋糕", "food", ["cake", "birthday", "蛋糕", "生日"], [path("M4 12h16v6H4z"), path("M4 18v2h16v-2M8 12V9a2 2 0 0 1 4 0v3m0 0V8a2 2 0 0 1 4 0v4"), line(4, 15, 20, 15)]),
  icon("coffee", "咖啡", "food", ["coffee", "drink", "咖啡", "饮料"], [path("M4 9h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5Z"), path("M17 11h1.8a2.7 2.7 0 0 1 0 5H17"), line(7, 3, 9, 6), line(11, 3, 13, 6), line(15, 3, 17, 6)]),
  icon("ice-cream-bowl", "冰淇淋", "food", ["ice cream", "dessert", "冰淇淋", "甜点"], [path("M5 13h14l-1.5 7h-11Z"), path("M7 12a5 5 0 0 1 10 0"), line(12, 4, 12, 8), line(9, 6, 9, 9), line(15, 6, 15, 9)]),
  icon("pizza", "披萨", "food", ["pizza", "food", "披萨", "食物"], [path("M3 4c7.4-2.8 13.2-.9 18 4.2L10.8 20 3 4Z"), circle(9, 9, 1), circle(14, 12, 1), circle(11, 15.5, 1)]),
  icon("popcorn", "爆米花", "food", ["popcorn", "movie", "爆米花", "电影"], [path("M6 8h12l-1 12H7L6 8Z"), path("M7 8a2.5 2.5 0 1 1 3.8-2.1A2.5 2.5 0 1 1 15.2 6 2.5 2.5 0 1 1 17 8")]),
  icon("plane", "飞机", "travel", ["plane", "flight", "飞机", "旅行"], [path("m2 16 8-4-8-4V6l11 3 6-6a1.4 1.4 0 0 1 2 2l-6 6 2 7-2 1-4-5-7 3Z")]),
  icon("car-front", "汽车", "travel", ["car", "drive", "汽车", "驾车"], [path("m5 16 1.7-6h10.6l1.7 6"), rect(3, 13, 18, 6, { rx: 1.5 }), circle(7.5, 17, 1), circle(16.5, 17, 1), line(8, 10, 16, 10)]),
  icon("bike", "自行车", "activity", ["bike", "cycle", "自行车", "骑行"], [circle(6, 17, 3), circle(18, 17, 3), path("M6 17 10 8h4l4 9M10 8l3 9M9 5h4")]),
  icon("train-front", "火车", "travel", ["train", "rail", "火车", "铁路"], [rect(5, 3, 14, 16, { rx: 2 }), line(5, 12, 19, 12), circle(9, 16, 1), circle(15, 16, 1), line(8, 21, 10, 19), line(16, 21, 14, 19), rect(8, 6, 3, 3), rect(13, 6, 3, 3)]),
  icon("map-pin", "地点", "travel", ["map pin", "place", "地点", "位置"], [path("M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z"), circle(12, 10, 2.5)]),
  icon("suitcase", "行李箱", "travel", ["suitcase", "luggage", "行李箱", "旅行"], [rect(4, 7, 16, 13, { rx: 2 }), path("M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2"), line(4, 12, 20, 12), line(8, 20, 8, 22), line(16, 20, 16, 22)]),
  icon("camera", "相机", "objects", ["camera", "photo", "相机", "照片"], [path("M4 8h4l1.5-2h5L16 8h4v11H4Z"), circle(12, 13.5, 3.2)]),
  icon("compass", "指南针", "travel", ["compass", "direction", "指南针", "方向"], [circle(12, 12, 9), polygon("14.8 9.2 13.2 14.1 9.2 14.8 10.8 9.9 14.8 9.2"), circle(12, 12, .7, fillStyle)]),
  icon("music", "音乐", "activity", ["music", "song", "音乐", "歌曲"], [path("M9 18V5l10-2v13"), circle(6, 18, 3), circle(16, 16, 3)]),
  icon("book-open", "书本", "objects", ["book", "read", "书本", "阅读"], [path("M3 5.5A2.5 2.5 0 0 1 5.5 3H11v16H5.5A2.5 2.5 0 0 0 3 21Z"), path("M21 5.5A2.5 2.5 0 0 0 18.5 3H13v16h5.5a2.5 2.5 0 0 1 2.5 2Z")]),
  icon("pencil", "铅笔", "objects", ["pencil", "write", "铅笔", "书写"], [path("m4 20 4.5-1 10-10a2.1 2.1 0 0 0-3-3l-10 10Z"), path("m13.5 7.5 3 3"), line(4, 20, 8.5, 19)]),
  icon("scissors", "剪刀", "objects", ["scissors", "cut", "剪刀", "裁剪"], [circle(6, 7, 2.2), circle(6, 17, 2.2), path("m8 8 12 8M8 16 20 8")]),
  icon("gift", "礼物", "objects", ["gift", "present", "礼物", "礼品"], [rect(3, 9, 18, 11, { rx: 1 }), rect(2, 6, 20, 4, { rx: 1 }), line(12, 6, 12, 20), path("M12 6H8.5a2.5 2.5 0 1 1 2.2-3.7C12 3.6 12 6 12 6Zm0 0h3.5a2.5 2.5 0 1 0-2.2-3.7C12 3.6 12 6 12 6Z")]),
  icon("balloon", "气球", "activity", ["balloon", "party", "气球", "派对"], [path("M12 3a6 7 0 0 1 6 7c0 4-3 6-6 6s-6-2-6-6a6 7 0 0 1 6-7Z"), path("M12 16v3l-2 2h4l-2-2")]),
  icon("smile", "笑脸", "people", ["smile", "happy", "笑脸", "开心"], [circle(12, 12, 9), circle(9, 10, .8, fillStyle), circle(15, 10, .8, fillStyle), path("M8 14c1 2 2.4 3 4 3s3-1 4-3")]),
  icon("cat", "小猫", "people", ["cat", "pet", "猫", "宠物"], [path("m4 10 1-6 4 3h6l4-3 1 6v5a8 8 0 0 1-16 0Z"), circle(9, 12, .7, fillStyle), circle(15, 12, .7, fillStyle), path("M10 15c1 .8 3 .8 4 0")]),
  icon("dog", "小狗", "people", ["dog", "pet", "狗", "宠物"], [path("M5 9 4 5l4 1 3-2 3 2 4-1-1 4a6.5 6.5 0 1 1-12 0Z"), circle(9, 12, .7, fillStyle), circle(15, 12, .7, fillStyle), path("M10 15c1 .7 3 .7 4 0")]),
  icon("bird", "小鸟", "nature", ["bird", "animal", "鸟", "动物"], [path("M4 15c2-6 7-8 13-7l3-3v6c0 5-4 9-9 9-3 0-5-2-7-5Z"), circle(15, 10, .7, fillStyle), path("M6 15c3 0 5 1 6 3")]),
  icon("fish", "小鱼", "nature", ["fish", "animal", "鱼", "动物"], [path("M3 12c3-4 8-5 13-1l5-3v8l-5-3c-5 4-10 3-13-1Z"), circle(8, 11, .8, fillStyle)]),
  icon("butterfly", "蝴蝶", "nature", ["butterfly", "nature", "蝴蝶", "自然"], [path("M12 12C9 5 3 4 3 8c0 3 3 5 7 5-3 3-2 7 1 7 2 0 1-5 1-8Zm0 0c3-7 9-8 9-4 0 3-3 5-7 5 3 3 2 7-1 7-2 0-1-5-1-8Z"), line(12, 7, 12, 19)]),
  icon("rainbow", "彩虹", "nature", ["rainbow", "weather", "彩虹", "天气"], [path("M3 20a9 9 0 0 1 18 0"), path("M7 20a5 5 0 0 1 10 0"), path("M11 20a1 1 0 0 1 2 0"), line(3, 20, 21, 20)]),
  icon("check", "完成", "symbols", ["check", "done", "完成", "确认"], [polyline("4 12 9 17 20 6")]),
  icon("plus", "添加", "symbols", ["plus", "add", "添加", "加号"], [line(12, 4, 12, 20), line(4, 12, 20, 12)]),
  icon("hash", "标签", "symbols", ["hash", "tag", "标签", "编号"], [line(9, 3, 7, 21), line(17, 3, 15, 21), line(4, 9, 20, 9), line(3, 15, 19, 15)]),
] as const

export const TAPE_ICON_BY_ID = new Map<CanvasTapeIconId, TapeIconDefinition>(TAPE_ICON_ENTRIES.map((entry) => [entry.id, entry]))

const emoji = (
  value: string,
  label: string,
  category: Exclude<TapePatternCategory, "all">,
  keywords: readonly string[],
): TapeEmojiEntry => ({ value, label, category, keywords })

export const TAPE_EMOJI_ENTRIES: readonly TapeEmojiEntry[] = [
  emoji("😀", "笑脸", "people", ["grinning", "face", "笑脸", "开心"]), emoji("😄", "大笑", "people", ["smile", "happy", "大笑"]), emoji("😁", "露齿笑", "people", ["grin", "face", "露齿"]), emoji("😂", "笑哭", "people", ["laugh", "tears", "笑哭"]),
  emoji("🤣", "笑翻", "people", ["rofl", "laugh", "笑翻"]), emoji("😊", "微笑", "people", ["smile", "warm", "微笑"]), emoji("🥰", "爱心脸", "people", ["love", "hearts", "爱心"]), emoji("😍", "花痴", "people", ["love", "eyes", "喜欢"]),
  emoji("🤩", "星星眼", "people", ["star", "eyes", "惊喜"]), emoji("😘", "亲亲", "people", ["kiss", "亲吻", "亲亲"]), emoji("😎", "墨镜", "people", ["cool", "sunglasses", "墨镜"]), emoji("🤔", "思考", "people", ["think", "thinking", "思考"]),
  emoji("🙌", "举手", "people", ["hands", "celebrate", "举手", "庆祝"]), emoji("👏", "鼓掌", "people", ["clap", "掌声", "鼓掌"]), emoji("👍", "赞", "people", ["thumbs up", "like", "点赞"]), emoji("👋", "挥手", "people", ["wave", "hello", "挥手"]),
  emoji("🐱", "猫咪", "nature", ["cat", "pet", "猫咪"]), emoji("🐶", "狗狗", "nature", ["dog", "pet", "狗狗"]), emoji("🐰", "兔子", "nature", ["rabbit", "animal", "兔子"]), emoji("🦊", "狐狸", "nature", ["fox", "animal", "狐狸"]),
  emoji("🐻", "熊", "nature", ["bear", "animal", "熊"]), emoji("🐼", "熊猫", "nature", ["panda", "animal", "熊猫"]), emoji("🐸", "青蛙", "nature", ["frog", "animal", "青蛙"]), emoji("🦋", "蝴蝶", "nature", ["butterfly", "nature", "蝴蝶"]),
  emoji("🌈", "彩虹", "nature", ["rainbow", "weather", "彩虹"]), emoji("☀️", "太阳", "nature", ["sun", "weather", "太阳"]), emoji("🌙", "月亮", "nature", ["moon", "night", "月亮"]), emoji("⭐", "星星", "nature", ["star", "night", "星星"]),
  emoji("🌸", "樱花", "nature", ["flower", "spring", "樱花"]), emoji("🌿", "绿叶", "nature", ["leaf", "plant", "绿叶"]), emoji("🍀", "四叶草", "nature", ["clover", "luck", "幸运"]), emoji("🌻", "向日葵", "nature", ["sunflower", "flower", "向日葵"]),
  emoji("🍎", "苹果", "food", ["apple", "fruit", "苹果"]), emoji("🍓", "草莓", "food", ["strawberry", "fruit", "草莓"]), emoji("🍒", "樱桃", "food", ["cherry", "fruit", "樱桃"]), emoji("🍋", "柠檬", "food", ["lemon", "fruit", "柠檬"]),
  emoji("🍉", "西瓜", "food", ["watermelon", "fruit", "西瓜"]), emoji("🍑", "桃子", "food", ["peach", "fruit", "桃子"]), emoji("🍰", "蛋糕", "food", ["cake", "dessert", "蛋糕"]), emoji("🍩", "甜甜圈", "food", ["donut", "dessert", "甜甜圈"]),
  emoji("🍪", "饼干", "food", ["cookie", "dessert", "饼干"]), emoji("🥐", "可颂", "food", ["croissant", "breakfast", "可颂"]), emoji("🍔", "汉堡", "food", ["burger", "food", "汉堡"]), emoji("🍙", "饭团", "food", ["rice", "food", "饭团"]), emoji("🥤", "饮料", "food", ["drink", "beverage", "饮料"]),
  emoji("⚽", "足球", "activity", ["soccer", "sport", "足球"]), emoji("🏀", "篮球", "activity", ["basketball", "sport", "篮球"]), emoji("🎾", "网球", "activity", ["tennis", "sport", "网球"]), emoji("🏆", "奖杯", "activity", ["trophy", "win", "奖杯"]),
  emoji("🎵", "音符", "activity", ["music", "note", "音乐"]), emoji("🎨", "调色盘", "activity", ["art", "palette", "艺术"]), emoji("🎁", "礼物", "activity", ["gift", "present", "礼物"]), emoji("🎈", "气球", "activity", ["balloon", "party", "气球"]),
  emoji("✈️", "飞机", "travel", ["plane", "travel", "飞机"]), emoji("🚗", "汽车", "travel", ["car", "drive", "汽车"]), emoji("🚲", "自行车", "travel", ["bike", "cycle", "自行车"]), emoji("🚆", "火车", "travel", ["train", "rail", "火车"]),
  emoji("🗺️", "地图", "travel", ["map", "travel", "地图"]), emoji("📍", "定位", "travel", ["pin", "place", "定位"]), emoji("🌍", "地球", "travel", ["world", "globe", "地球"]), emoji("🏝️", "岛屿", "travel", ["island", "vacation", "岛屿"]),
  emoji("📷", "相机", "objects", ["camera", "photo", "相机"]), emoji("📚", "书本", "objects", ["book", "read", "书本"]), emoji("✏️", "铅笔", "objects", ["pencil", "write", "铅笔"]), emoji("✂️", "剪刀", "objects", ["scissors", "cut", "剪刀"]),
  emoji("👜", "手提包", "objects", ["bag", "fashion", "手提包"]), emoji("🎧", "耳机", "objects", ["headphones", "music", "耳机"]), emoji("💡", "灯泡", "objects", ["idea", "light", "灯泡"]), emoji("🔑", "钥匙", "objects", ["key", "unlock", "钥匙"]),
  emoji("✅", "完成", "symbols", ["check", "done", "完成"]), emoji("❌", "关闭", "symbols", ["cross", "close", "关闭"]), emoji("❤️", "红心", "symbols", ["heart", "love", "红心"]), emoji("✨", "闪光", "symbols", ["sparkles", "magic", "闪光"]),
  emoji("💬", "对话", "symbols", ["speech", "chat", "对话"]), emoji("❗", "感叹", "symbols", ["important", "exclamation", "感叹"]), emoji("❓", "疑问", "symbols", ["question", "help", "疑问"]), emoji("➕", "加号", "symbols", ["plus", "add", "加号"]), emoji("🎀", "蝴蝶结", "objects", ["ribbon", "gift", "蝴蝶结"]), emoji("🧸", "玩偶", "objects", ["teddy", "toy", "玩偶"]), emoji("💎", "宝石", "objects", ["gem", "jewel", "宝石"]),
] as const

export function defaultTapeIconColor(background: string): string {
  const normalized = background.toLowerCase()
  const index = TAPE_BACKGROUND_COLORS.findIndex((color) => color === normalized)
  return CANVAS_TAPE_ICON_COLORS[index >= 0 ? index : 0] ?? CANVAS_TAPE_ICON_COLORS[0]
}

export function patternKey(pattern: CanvasTapePattern): string {
  return pattern.kind === "emoji" ? `emoji:${pattern.value}` : `icon:${pattern.id}:${pattern.color.toLowerCase()}`
}

const RECENT_LIMIT = 12
export const TAPE_PATTERN_RECENT_VERSION = 1

export function tapePatternStorageKey(accountId: string): string {
  return `memento:tape-patterns:v${TAPE_PATTERN_RECENT_VERSION}:${accountId}`
}

export function readRecentTapePatterns(accountId: string): CanvasTapePattern[] {
  if (typeof localStorage === "undefined" || !accountId) return []
  try {
    const raw = localStorage.getItem(tapePatternStorageKey(accountId))
    if (!raw) return []
    const value: unknown = JSON.parse(raw)
    if (!value || typeof value !== "object" || !("version" in value) || value.version !== TAPE_PATTERN_RECENT_VERSION || !("items" in value) || !Array.isArray(value.items)) return []
    const result: CanvasTapePattern[] = []
    for (const item of value.items) {
      const parsed = canvasTapePatternSchema.safeParse(item)
      if (parsed.success && !result.some((existing) => patternKey(existing) === patternKey(parsed.data))) result.push(parsed.data)
      if (result.length >= RECENT_LIMIT) break
    }
    return result
  } catch {
    return []
  }
}

export function rememberTapePattern(accountId: string, pattern: CanvasTapePattern): void {
  if (typeof localStorage === "undefined" || !accountId) return
  try {
    const next = [pattern, ...readRecentTapePatterns(accountId).filter((item) => patternKey(item) !== patternKey(pattern))].slice(0, RECENT_LIMIT)
    localStorage.setItem(tapePatternStorageKey(accountId), JSON.stringify({ version: TAPE_PATTERN_RECENT_VERSION, items: next }))
  } catch {
    // Quota and privacy-mode failures should not prevent using a tape.
  }
}

export function findTapeEmoji(value: string): TapeEmojiEntry | undefined {
  return TAPE_EMOJI_ENTRIES.find((entry) => entry.value === value)
}

export function findTapeIcon(id: CanvasTapeIconId): TapeIconDefinition | undefined {
  return TAPE_ICON_BY_ID.get(id)
}
