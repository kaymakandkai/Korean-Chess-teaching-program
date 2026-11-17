// 상황별 대국: 연습 지형 모음
// 모든 퍼즐은 엔진으로 검증되었다 (tests/scenarios.test.ts)
import { CHO, HAN, Side } from './engine/constants';
import type { LevelId } from './engine/levels';
import { buildInitialPosition } from './engine/setup';

export type ScenarioGoal =
  | { type: 'mate'; within: number }
  | { type: 'material'; gain: number; within: number }
  | { type: 'survive'; moves: number; maxLoss: number }
  | { type: 'win' }
  | { type: 'play' };

export interface Scenario {
  id: string;
  title: string;
  category: '외통 연습' | '전술' | '수비' | '종반' | '대국';
  stars: 1 | 2 | 3;
  fen: string;
  userSide: Side;
  level: LevelId;
  summary: string;
  goal: ScenarioGoal;
  goalText: string;
  lesson: string;
  hints: string[];
}

const LETTERS = ' KAEHRCP';

/**
 * 기보 좌표로 국면을 만든다. 'R61' = 6번 가로줄 1번 세로줄의 차.
 * 가로줄: 위(한 쪽)부터 1~9, 맨 아래 0 / 세로줄: 왼쪽부터 1~9 (초 기준)
 */
export function fenFromPieces(cho: string[], han: string[], toMove: Side): string {
  const b: string[][] = Array.from({ length: 10 }, () => Array(9).fill(''));
  const put = (list: string[], upper: boolean) => {
    for (const t of list) {
      const ch = t[0];
      if (!LETTERS.includes(ch)) throw new Error('bad piece ' + t);
      const r = (Number(t[1]) + 9) % 10;
      const c = Number(t[2]) - 1;
      if (b[r][c]) throw new Error('duplicate square ' + t);
      b[r][c] = upper ? ch : ch.toLowerCase();
    }
  };
  put(cho, true);
  put(han, false);
  const rows = b.map((row) => {
    let out = '';
    let empty = 0;
    for (const x of row) {
      if (!x) {
        empty++;
        continue;
      }
      if (empty) out += empty;
      empty = 0;
      out += x;
    }
    if (empty) out += empty;
    return out;
  });
  return rows.join('/') + (toMove === CHO ? ' w' : ' b');
}

export const SCENARIOS: Scenario[] = [
  {
    id: 'mate-two-chariots',
    title: '양차 외통',
    category: '외통 연습',
    stars: 1,
    fen: fenFromPieces(['K94', 'A04', 'R61', 'R29'], ['K15', 'A14', 'E16', 'P41', 'P49'], CHO),
    userSide: CHO,
    level: 'legend',
    summary: '두 차가 힘을 합쳐 궁을 잡는 가장 기본적인 외통.',
    goal: { type: 'mate', within: 2 },
    goalText: '2수 안에 외통',
    lesson:
      '한 차는 2번 가로줄을 지키고 있습니다. 다른 차로 궁의 세로줄에 장군을 부르면, 상대는 사로 막을 수밖에 없습니다. 막은 사를 차로 잡으면 궁성 중앙의 차가 대각선까지 지배합니다.',
    hints: ['궁이 있는 5번 세로줄을 노리세요.', '61의 차를 65로 옮겨 장군을 불러 보세요.', '사가 25로 막으면 29의 차로 잡으세요.'],
  },
  {
    id: 'mate-cannon-chariot',
    title: '포·차 연계 외통',
    category: '외통 연습',
    stars: 2,
    fen: fenFromPieces(['K94', 'A04', 'C71', 'P73', 'P45', 'R29'], ['K15', 'A14', 'E16', 'P41', 'P49'], CHO),
    userSide: CHO,
    level: 'legend',
    summary: '포는 다리를 넘어 장군을 부르고, 차가 마무리합니다.',
    goal: { type: 'mate', within: 2 },
    goalText: '2수 안에 외통',
    lesson:
      '포는 반드시 기물 하나를 넘어야 움직입니다. 73의 졸을 다리 삼아 포를 5번 세로줄로 옮기면 45의 졸을 다시 다리로 삼아 장군이 됩니다. 상대가 사로 막으면 다리가 둘이 되어 장군이 풀리지만, 그 사를 차로 잡으면 포가 차를 지켜 줍니다.',
    hints: ['포가 5번 세로줄에 오면 무슨 일이 생길까요?', '포 71→75: 73의 졸을 넘어갑니다.', '막으러 온 사를 29의 차로 잡으세요.'],
  },
  {
    id: 'mate-soldier-palace',
    title: '졸의 궁성 침투',
    category: '외통 연습',
    stars: 1,
    fen: fenFromPieces(['K94', 'A04', 'P34', 'H44', 'R81'], ['K15', 'E17', 'H12', 'R01', 'P47'], CHO),
    userSide: CHO,
    level: 'legend',
    summary: '상대 궁성 안에서 졸은 대각선으로도 움직입니다.',
    goal: { type: 'mate', within: 1 },
    goalText: '1수 만에 외통',
    lesson:
      '졸(병)은 상대 궁성 안에 들어가면 궁성의 대각선을 따라 앞으로 움직일 수 있습니다. 34의 졸이 궁성 중앙 25로 들어가면 궁의 앞과 양 옆 대각선을 모두 공격하고, 44의 마가 졸을 지켜 줍니다.',
    hints: ['궁성 중앙(25)은 대각선이 모이는 자리입니다.', '졸이 25로 가면 44의 마가 지켜 줍니다.'],
  },
  {
    id: 'mate-horse-chariot',
    title: '마·차 외통',
    category: '외통 연습',
    stars: 2,
    fen: fenFromPieces(['K94', 'A04', 'R61', 'H37'], ['K15', 'A14', 'E26', 'P41', 'P49'], CHO),
    userSide: CHO,
    level: 'legend',
    summary: '마가 도망길을 막고 차가 장군을 부르는 협공.',
    goal: { type: 'mate', within: 2 },
    goalText: '2수 안에 외통',
    lesson:
      '37의 마는 16과 25를 지키고 있습니다. 차가 5번 세로줄에서 장군을 부르면 상대는 사로 막아야 하고, 그 사를 차로 잡으면 마가 차를 지켜 외통이 됩니다. 마의 길목(멱)이 막혀 있지 않은지 늘 확인하세요.',
    hints: ['마가 지키는 칸을 세어 보세요: 16, 25.', '차 61→65로 장군!', '25로 막은 사를 차로 잡으면 됩니다.'],
  },
  {
    id: 'mate-chariot-diagonal',
    title: '궁성 대각선의 차',
    category: '외통 연습',
    stars: 1,
    fen: fenFromPieces(['K94', 'A06', 'R55', 'H44'], ['K14', 'R81', 'C79', 'P73', 'P49'], CHO),
    userSide: CHO,
    level: 'legend',
    summary: '차는 궁성 안에서 대각선으로도 움직이고 공격합니다.',
    goal: { type: 'mate', within: 1 },
    goalText: '1수 만에 외통',
    lesson:
      '궁성 중앙에 들어간 차는 대각선 방향의 모든 귀퉁이를 공격합니다. 상대 궁(14) 옆의 15와 24, 대각선의 14까지 한꺼번에 막히게 됩니다. 마(44)가 25를 지켜 주는 것이 핵심입니다.',
    hints: ['상대 궁이 갈 수 있는 칸: 15, 24, 25.', '25 한 칸이 이 세 칸을 모두 공격합니다.'],
  },
  {
    id: 'fork-horse',
    title: '마의 양걸이',
    category: '전술',
    stars: 2,
    fen: fenFromPieces(
      ['K95', 'A94', 'A96', 'H65', 'R01', 'C82', 'P71', 'P75', 'P79'],
      ['K25', 'A14', 'A16', 'R58', 'E13', 'H18', 'P41', 'P43', 'P49'],
      CHO,
    ),
    userSide: CHO,
    level: 'advanced',
    summary: '장군을 부르면서 동시에 차를 노리는 한 수를 찾으세요.',
    goal: { type: 'material', gain: 10, within: 3 },
    goalText: '3수 안에 기물 점수 10점 이상 이득',
    lesson:
      '마는 한 번에 여러 칸을 공격합니다. 장군을 부르면서 다른 기물을 함께 노리면(양걸이), 상대는 궁을 먼저 살려야 하므로 나머지 기물을 지킬 수 없습니다. 이때 마의 멱(다리 자리)이 막히지 않았는지 확인하세요.',
    hints: ['상대 궁(25)과 차(58)를 동시에 공격하는 칸이 있습니다.', '마 65→46: 25와 58을 함께 노립니다.'],
  },
  {
    id: 'bridge-double',
    title: '다리 놓기 양수겸장',
    category: '전술',
    stars: 3,
    fen: fenFromPieces(
      ['K94', 'A04', 'A06', 'C85', 'H63', 'R01', 'P71'],
      ['K15', 'A14', 'A16', 'R36', 'E17', 'P41', 'P49', 'H18'],
      CHO,
    ),
    userSide: CHO,
    level: 'advanced',
    summary: '포의 다리가 되어 장군을 부르는 동시에 상대 차를 공격하세요.',
    goal: { type: 'material', gain: 5, within: 3 },
    goalText: '3수 안에 기물 점수 5점 이상 이득',
    lesson:
      '포는 앞에 다리가 생기는 순간 장군이 됩니다. 마를 포 앞 5번 세로줄로 옮기면 포 장군과 마의 공격이 동시에 일어납니다. 상대가 장군을 막느라 바쁠 때 차를 얻을 수 있습니다.',
    hints: ['85의 포 앞(5번 세로줄)은 비어 있습니다.', '마 63→55가 다리가 되면서 36의 차를 노립니다.'],
  },
  {
    id: 'answer-check',
    title: '장군 받기: 잡을까, 피할까?',
    category: '수비',
    stars: 1,
    fen: fenFromPieces(
      ['K95', 'A04', 'A06', 'H72', 'R09', 'P71', 'P75', 'P79', 'C88'],
      ['K15', 'A14', 'A16', 'R91', 'C32', 'P41', 'P49', 'E13'],
      CHO,
    ),
    userSide: CHO,
    level: 'advanced',
    summary: '상대 차가 장군을 불렀습니다. 가장 이득인 방법으로 받으세요.',
    goal: { type: 'material', gain: 10, within: 2 },
    goalText: '장군을 받으면서 10점 이상 이득',
    lesson:
      '장군을 받는 방법은 세 가지입니다: ① 궁을 피한다 ② 사이를 막는다 ③ 장군 부른 기물을 잡는다. 잡을 수 있다면 대부분 가장 좋은 방법입니다. 마의 멱(81)이 비어 있는지 확인해 보세요.',
    hints: ['장군을 부른 기물은 91의 차입니다.', '72의 마가 91로 갈 수 있을까요?'],
  },
  {
    id: 'block-cannon-check',
    title: '포 장군 막기',
    category: '수비',
    stars: 2,
    fen: 'C1e2ke1r/4a4/7c1/r8/1p3h1pp/4p4/2PPEEPP1/3ARH3/1c3K3/RH1A5 b',
    userSide: HAN,
    level: 'advanced',
    summary: '상대 포가 장군을 불렀습니다. 받을 수 있는 수 6가지 중 버틸 수 있는 수는 하나뿐.',
    goal: { type: 'survive', moves: 3, maxLoss: 3 },
    goalText: '장군을 막고 3수 동안 큰 손해 없이 버티기',
    lesson:
      '포 장군은 다리(사이 기물)가 정확히 하나일 때만 성립합니다. 사이에 기물을 하나 더 놓아 다리를 둘로 만들면 포는 넘을 수 없어 장군이 풀립니다. 궁을 피할 곳이 나쁠 때 아주 유용한 수비법입니다.',
    hints: ['장군을 부른 것은 11의 포이고, 다리는 13의 상입니다.', '11과 16 사이에 기물을 하나 더 놓으면 장군이 풀립니다.', '92의 포가 12로 올 수 있습니다.'],
  },
  {
    id: 'stop-mate-threat',
    title: '외통 위협 막기',
    category: '수비',
    stars: 3,
    fen: '4aa3/4k2c1/4r4/p1EC4p/2PP2p2/9/4R4/1C5h1/4AA3/5KE2 w',
    userSide: CHO,
    level: 'advanced',
    summary: '상대가 다음 수에 외통을 노립니다. 33가지 수 중 살아남는 수는 단 둘!',
    goal: { type: 'survive', moves: 3, maxLoss: 3 },
    goalText: '외통 위협을 막고 3수 동안 큰 손해 없이 버티기',
    lesson:
      '내 차례가 오면 가장 먼저 "상대가 지금 무엇을 노리는가"를 확인하세요. 상대 포(28)는 88의 마를 다리 삼아 08로 넘어올 수 있고, 그러면 07의 상을 다리로 내 궁에 외통이 됩니다. 위협을 막는 방법 중에는 장군을 부르며 시간을 버는 공격적인 방법도 있습니다.',
    hints: ['상대 포(28)가 08로 오면 어떻게 될까요?', '장군을 부르면 상대는 외통을 둘 시간이 없습니다.', '내 차(75)로 상대 차(35)를 잡으며 장군을 부를 수 있습니다.'],
  },
  {
    id: 'only-defense',
    title: '단 하나의 수비',
    category: '수비',
    stars: 3,
    fen: '5a3/3a1k3/7c1/2R5p/1p1r2p2/9/1PP1P3P/1C2CA3/4K4/3A2c2 b',
    userSide: HAN,
    level: 'advanced',
    summary: '상대 차가 궁 옆줄로 들어오면 외통입니다. 31가지 수 중 살아남는 수는 오직 하나.',
    goal: { type: 'survive', moves: 3, maxLoss: 3 },
    goalText: '외통 위협을 막고 3수 동안 큰 손해 없이 버티기',
    lesson:
      '상대가 노리는 칸을 미리 지키는 것이 수비의 기본입니다. 상대 차(43)가 46으로 들어오면 내 궁(26)은 피할 곳이 없습니다. 그 칸을 지킬 수 있는 기물을 찾아 미리 옮겨 두세요. 사를 움직이는 수비는 오히려 궁성을 약하게 만듭니다.',
    hints: ['상대 차(43)가 46으로 오면 외통이 됩니다.', '46 칸을 지킬 수 있는 내 기물은 무엇일까요?', '54의 차를 56으로 옮기면 46을 지킵니다.'],
  },
  {
    id: 'end-chariot-soldier',
    title: '차·졸로 마무리',
    category: '종반',
    stars: 1,
    fen: fenFromPieces(['K95', 'A04', 'R61', 'P47'], ['K15', 'A14', 'A16'], CHO),
    userSide: CHO,
    level: 'expert',
    summary: '차와 졸 하나로 사 둘을 지키는 궁을 무너뜨리세요.',
    goal: { type: 'win' },
    goalText: '외통으로 승리',
    lesson:
      '종반에는 서두르지 말고 졸을 한 칸씩 궁성으로 밀어 넣으세요. 차는 궁의 도망길(가로줄)을 막는 역할을 하고, 궁성에 들어간 졸이 사를 하나씩 떼어 냅니다. 내 궁이 상대 궁과 마주보지 않도록(빅장) 주의하세요.',
    hints: ['차로 2번 가로줄을 막아 궁을 가둬 보세요.', '졸이 궁성 귀(34, 36)에 들어가면 대각선으로 중앙을 노립니다.'],
  },
  {
    id: 'end-horse-soldiers',
    title: '마·졸 연계 종반',
    category: '종반',
    stars: 2,
    fen: fenFromPieces(['K95', 'A04', 'H64', 'P43', 'P47'], ['K15', 'A14', 'A16'], CHO),
    userSide: CHO,
    level: 'expert',
    summary: '기물이 적을수록 마와 졸의 가치가 커집니다.',
    goal: { type: 'win' },
    goalText: '외통으로 승리',
    lesson:
      '종반의 마는 궁성 주변 칸을 지배해 궁의 도망길을 끊습니다. 졸 두 개를 나란히 붙여 서로 지키게 하면서 궁성으로 들어가세요. 졸은 뒤로 물러날 수 없으니 한 칸 한 칸 신중하게!',
    hints: ['마를 궁성 가까이(45, 46 근처) 두면 졸을 지원하기 좋습니다.', '졸끼리 옆으로 붙어 있으면 서로를 지켜 줍니다.'],
  },
  {
    id: 'end-chariot-horse',
    title: '차·마로 궁성 공략',
    category: '종반',
    stars: 2,
    fen: fenFromPieces(['K95', 'A04', 'R61', 'H73'], ['K15', 'A14', 'A16', 'E13'], CHO),
    userSide: CHO,
    level: 'expert',
    summary: '차와 마의 협공으로 사·상이 지키는 궁을 잡으세요.',
    goal: { type: 'win' },
    goalText: '외통으로 승리',
    lesson:
      '차는 줄을 막고 마는 칸을 지킵니다. 마를 궁성 근처로 데려와 궁이 피할 칸을 줄인 뒤 차로 장군을 부르세요. 상대 상(13)이 내 기물을 노리지 않는지도 살펴야 합니다.',
    hints: ['먼저 마를 앞으로 전개하세요.', '사가 막으러 오면 그 사를 잡을 수 있는지 계산해 보세요.'],
  },
  {
    id: 'end-four-soldiers',
    title: '졸 넷의 힘',
    category: '종반',
    stars: 3,
    fen: fenFromPieces(['K95', 'A04', 'P41', 'P43', 'P47', 'P49'], ['K15', 'A14', 'A16'], CHO),
    userSide: CHO,
    level: 'expert',
    summary: '졸만으로 궁성을 함락하는 어려운 종반.',
    goal: { type: 'win' },
    goalText: '외통으로 승리',
    lesson:
      '졸은 하나씩 들어가면 사에게 잡힙니다. 두세 개를 나란히 붙여 함께 전진하고, 궁성 귀퉁이를 먼저 차지하세요. 졸을 아끼면서 사를 떼어 내는 순서가 중요합니다.',
    hints: ['바깥쪽 졸(41, 49)을 안쪽으로 모으세요.', '졸 두 개가 궁성 앞에 나란히 서면 사가 쉽게 잡지 못합니다.'],
  },
  {
    id: 'handicap-chariot',
    title: '차 떼고 두기',
    category: '대국',
    stars: 1,
    fen: buildInitialPosition({ formations: ['마상마상', '마상마상'], removed: [[], ['R0']], first: CHO }).toFen(),
    userSide: CHO,
    level: 'intermediate',
    summary: '상대가 차 하나를 떼고 시작합니다. 우세를 승리로 바꾸는 연습.',
    goal: { type: 'win' },
    goalText: '승리',
    lesson:
      '기물이 앞설 때는 무리한 공격보다 안전한 교환으로 판을 단순하게 만드는 것이 좋습니다. 상대 차가 없는 쪽(상대의 왼쪽, 내 오른쪽 9번 세로줄)으로 공격하면 수비가 약합니다.',
    hints: ['상대 차가 없는 9번 세로줄 쪽을 공략하세요.', '기물을 교환할수록 차 하나의 차이가 커집니다.'],
  },
];

export function scenarioById(id: string) {
  return SCENARIOS.find((s) => s.id === id);
}
