import type { AssaultApproach, DialogueChoice, DistrictId, SpeakerId } from '../types/game';

export interface SpeakerMeta {
  name: string;
  role: string;
}

export interface DialogueLine {
  speaker: SpeakerId;
  text: string;
  duration?: number;
}

export type BranchMomentId =
  | 'rooftop_prologue'
  | 'motel_artem'
  | 'tower_assault_plan'
  | 'smasher_execution'
  | 'cyberspace_ending';

export interface BranchChoiceSet {
  id: BranchMomentId;
  title: string;
  choices: DialogueChoice[];
}

export interface BranchResponse {
  choiceId: string;
  momentId: BranchMomentId;
  affinityDelta: number;
  approach?: AssaultApproach;
  lines: DialogueLine[];
}

export const SPEAKER_META: Record<SpeakerId, SpeakerMeta> = {
  ai: { name: 'АИ (АМИР)', role: 'НАЁМНИК // КИБЕР-АЛМАТЫ' },
  samir: { name: 'САМИР', role: 'ЦИФРОВОЙ КОНСТРУКТ // БИОЧИП' },
  sanzhar: { name: 'САНЖАР', role: 'НАПАРНИК И ЛУЧШИЙ ДРУГ' },
  rodion: { name: 'РОДИОН МАРАКУЛИН', role: 'НАСЛЕДНИК // МАРАКУЛИН КОРП' },
  lev: { name: 'ЛЕВ МАРАКУЛИН', role: 'ГЛАВА МЕГАКОРПОРАЦИИ' },
  artem: { name: 'АРТЁМ', role: 'ФИКСЕР // КИБЕР-ТАСТАК' },
  akhmed: { name: 'КИБЕР-АХМЕД', role: 'АВТОНОМНОЕ ТАКСИ-ИИ' },
  smasher: { name: 'РИХАРД СМЭШЕР', role: 'ОХРАННИК КЛАССА ОМЕГА' },
  taisiya: { name: 'ТАИСИЯ', role: 'АРХИТЕКТОР ЗА ЧЁРНЫМ ЗАСЛОНОМ' },
  egor: { name: 'ЕГОР', role: 'ТАИНСТВЕННЫЙ ЗАКАЗЧИК' },
  ripperdoc: { name: 'РИПЕРДОК «МАРУМА»', role: 'КИБЕРХИРУРГ ЕБЛАНХАНЫ' },
  system: { name: 'СИСТЕМА', role: 'НЕЙРОИНТЕРФЕЙС БИОЧИПА' },
};

const CENSOR_REPLACEMENTS: Array<[RegExp, string]> = [
  [/ебанат/gi, 'чудак'],
  [/блять/gi, 'чёрт'],
  [/ебашить/gi, 'разносить'],
  [/проеби/gi, 'потеряй'],
  [/охуев/gi, 'ошалев'],
  [/грёбаный/gi, 'чёртов'],
  [/дерьма/gi, 'мусора'],
  [/Ебланханы/g, 'Алматы-Хаба'],
  [/Ебланхана/g, 'Алматы-Хаб'],
  [/Ебланхане/g, 'Алматы-Хабе'],
  [/Ебланхану/g, 'Алматы-Хаб'],
  [/ЕБЛАНХАНА/g, 'АЛМАТЫ-ХАБ'],
  [/ЕБЛАНХАНЫ/g, 'АЛМАТЫ-ХАБА'],
  [/ЕБЛАНХАНЕ/g, 'АЛМАТЫ-ХАБЕ'],
  [/ЕБЛАНХАНУ/g, 'АЛМАТЫ-ХАБ'],
  [/ебланхана/g, 'Алматы-Хаб'],
  [/ебланханы/g, 'Алматы-Хаба'],
  [/ебланхане/g, 'Алматы-Хабе'],
  [/ебланхану/g, 'Алматы-Хаб'],
  [/Хуеши/g, 'Микоши'],
  [/ХУЕШИ/g, 'МИКОШИ'],
  [/хуеши/g, 'Микоши'],
];

/**
 * Applies optional profanity censorship while preserving authentic scenario dialogue by default.
 */
export function formatDialogueText(raw: string, censored: boolean): string {
  if (!censored) return raw;
  let result = raw;
  for (const [pattern, replacement] of CENSOR_REPLACEMENTS) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

export function clampAffinity(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)));
}

export const DISTRICT_SAMIR_BANTER: Record<DistrictId, string[]> = {
  cyber_tastak: [
    'Кибер-Тастак... Дешёвый хром, вонючий неон и мотель того крысёныша Артёма.',
    'Говорят, где-то в переулках Тастака фиксеры припрятали мой старый Malorian S-3516. Заберём его.',
  ],
  abay_eblanhana: [
    'Проспект Абая... сердце Ебланханы. Загляни в антикафе «Марум» — там нормальный рипердок и свежие заказы.',
    'Люблю ночной Алматы. Неон отражается в лужах, а над головой горы. Красиво, пока корпы не портят вид.',
  ],
  junkyard: [
    'Свалка. Место, где твоя история должна была закончиться, а наша с тобой — только началась.',
    'Гляди в оба: мусорщики здесь разбирают на хром всё, что ещё дышит.',
  ],
  marakulin_plaza: [
    'Маракулин Тауэр... В 2026 я шёл сюда один. Теперь нас двое в одной башке, и на этот раз мы дойдём до конца.',
    'Главный вход заблокирован, пока не будешь готов. Поднимись на смотровую крышу — и начнём.',
  ],
  koktobe_overlook: [
    'Отсюда весь Кибер-Алматы как на ладони. И телебашня Кок-Тобе, и проклятая башня Маракулиных.',
    'Когда соберёшься идти на штурм — поднимайся на крышу террасы. Это будет точка невозврата.',
  ],
};

export const AKHMED_DRIVING_LINES: string[] = [
  'Кибер-Ахмед на связи, брат! Пристегни нейропорт — идём по проспекту Абая.',
  'Режим «Комфорт+» активирован. В случае корпо-погони могу врубить нитро!',
  'Оплата в кибер-тенге не требуется — для друзей Санжара поездки бесплатно.',
  'Осторожнее на поворотах, Аи! Бампер только вчера на Кибер-Тастаке переварили.',
  'Автопилот проложен. Доставлю до места быстрее, чем корпы перезарядят дроны.',
];

/**
 * Linear-nonlinear branching dialogue moments faithful to Сценарий.odt.
 * Choices shape Samir affinity, tactical assault advantages, and finale dialogue while keeping canonical story beats intact.
 */
export const BRANCHING_CHOICES: Record<BranchMomentId, BranchChoiceSet> = {
  rooftop_prologue: {
    id: 'rooftop_prologue',
    title: 'КРЫША КОК-ТОБЕ // САМИР НАПРОТИВ',
    choices: [
      {
        id: 'rooftop_skeptic',
        key: '1',
        text: '«Самоубийственный штурм? Не лучший план, Самир.»',
        subtext: 'Усомниться в плане // Отношения с Самиром -5',
        affinityDelta: -5,
      },
      {
        id: 'rooftop_burn_tower',
        key: '2',
        text: '«Выкладывай план. Пора сжечь Маракулин Тауэр.»',
        subtext: 'Поддержать Самира // Отношения с Самиром +15',
        affinityDelta: 15,
      },
    ],
  },
  motel_artem: {
    id: 'motel_artem',
    title: 'МОТЕЛЬ АРТЁМА // КИБЕР-ТАСТАК',
    choices: [
      {
        id: 'motel_confront_artem',
        key: '1',
        text: '«Санжар погиб из-за этого заказа. Биочип не стоит его жизни.»',
        subtext: 'Высказать фиксеру всё перед тем, как уйти к раковине',
        affinityDelta: 5,
      },
      {
        id: 'motel_silent_wash',
        key: '2',
        text: '(Молча пойти в ванную — канон сценария)',
        subtext: 'Ничего не отвечать Артёму и пойти умыться к раковине',
        affinityDelta: 0,
      },
    ],
  },
  tower_assault_plan: {
    id: 'tower_assault_plan',
    title: 'ТОЧКА НЕВОЗВРАТА // ПЛАН ШТУРМА МАРАКУЛИН ТАУЭР',
    choices: [
      {
        id: 'assault_frontal',
        key: '1',
        text: '«Парадный прорыв («Как в 2026»)»',
        subtext: 'Лобовой штурм через главный вход с Самиром // Отношения с Самиром +10',
        affinityDelta: 10,
        approach: 'frontal',
      },
      {
        id: 'assault_netrunner',
        key: '2',
        text: '«Нетраннерский взлом башни»',
        subtext: 'Усилено заказом «Ретранслятор Тастака»: отключает турели холла и ослабляет броню Смэшера на 20%',
        affinityDelta: 5,
        approach: 'netrunner',
      },
      {
        id: 'assault_eblanhana',
        key: '3',
        text: '«Поддержка Ебланханы и Кибер-Ахмеда»',
        subtext: 'Усилено при REP ≥ 5 или ≥2 заказах: полная броня, +2 MaxDoc и тактический сброс Кибер-Ахмеда',
        affinityDelta: 5,
        approach: 'eblanhana',
      },
    ],
  },
  smasher_execution: {
    id: 'smasher_execution',
    title: 'РИХАРД СМЭШЕР НА КОЛЕНЯХ // MALORIAN S-3516',
    choices: [
      {
        id: 'smasher_for_sanzhar',
        key: '1',
        text: '«Это за Санжара и за 2026 год.»',
        subtext: 'Почтить напарника и Самира перед выстрелом // Отношения +15',
        affinityDelta: 15,
      },
      {
        id: 'smasher_hell_rodion',
        key: '2',
        text: '«Передай привет Родиону в аду.»',
        subtext: 'Холодная точка в истории Маракулиных // Отношения +10',
        affinityDelta: 10,
      },
    ],
  },
  cyberspace_ending: {
    id: 'cyberspace_ending',
    title: 'ВЫБОР В ХУЕШИ — РЕШЕНИЕ ТАИСИИ',
    choices: [
      {
        id: 'ending_marum',
        key: '1',
        text: 'ВЕРНУТЬСЯ В СВОЁ ТЕЛО (ЛЕГЕНДА ЕБЛАНХАНЫ)',
        subtext: 'Прожить полгода как легенда антикафе «Марум» и принять контракт Егора',
      },
      {
        id: 'ending_taldykorgan',
        key: '2',
        text: 'ОТДАТЬ ТЕЛО САМИРУ (УЕХАТЬ В ТАЛДЫКОРГАН)',
        subtext: 'Самир в теле Аи покидает Кибер-Алматы и уезжает в город-ад Талдыкорган',
      },
    ],
  },
};

export const BRANCH_RESPONSES: Record<string, BranchResponse> = {
  // 1. Rooftop Prologue (Cyberpunk 2077 rooftop screenshot beat + Сценарий.odt)
  rooftop_skeptic: {
    choiceId: 'rooftop_skeptic',
    momentId: 'rooftop_prologue',
    affinityDelta: -5,
    lines: [
      {
        speaker: 'ai',
        text: 'Самоубийственный штурм? Не лучший план, Самир. Не знаешь какого друга послать насмерть?',
        duration: 4.5,
      },
      {
        speaker: 'samir',
        text: 'Благо у тебя есть один кент, который уже мёртв. Ты, я и Маракуя Тауэр — звучит как припевы в песнях Минтимера. Но оно того стоит!',
        duration: 6.0,
      },
      {
        speaker: 'samir',
        text: 'Вспомни, с чего вообще всё началось две недели назад... с тебя, Санжара и проклятого пентхауса Родиона.',
        duration: 4.8,
      },
    ],
  },
  rooftop_burn_tower: {
    choiceId: 'rooftop_burn_tower',
    momentId: 'rooftop_prologue',
    affinityDelta: 15,
    lines: [
      {
        speaker: 'ai',
        text: 'Выкладывай план. Пора сжечь Маракулин Тауэр. Не знаешь какого друга послать насмерть?',
        duration: 4.4,
      },
      {
        speaker: 'samir',
        text: 'Ха! Вот это мой Аи! Благо у тебя есть один кент, который уже мёртв. Ты, я и Маракуя Тауэр — звучит как припевы в песнях Минтимера. Но оно того стоит!',
        duration: 6.2,
      },
      {
        speaker: 'samir',
        text: 'Только прежде чем выбивать парадную дверь... давай прокрутим в башке, как две недели назад всё покатилось в пекло.',
        duration: 4.8,
      },
    ],
  },

  // 2. Motel Artem Confrontation (Cyber-Tastak)
  motel_confront_artem: {
    choiceId: 'motel_confront_artem',
    momentId: 'motel_artem',
    affinityDelta: 5,
    lines: [
      {
        speaker: 'ai',
        text: 'Санжар погиб из-за этого заказа, Артём. Ни один грёбаный биочип не стоит его жизни.',
        duration: 4.6,
      },
      {
        speaker: 'artem',
        text: 'Следи за языком, Амир. Лев Маракулин мёртв, вся корпорация на ушах, а ты притащил ко мне хвост! Иди умойся в ванной, пока я решаю, что с нами делать.',
        duration: 5.5,
      },
    ],
  },
  motel_silent_wash: {
    choiceId: 'motel_silent_wash',
    momentId: 'motel_artem',
    affinityDelta: 0,
    lines: [
      {
        speaker: 'artem',
        text: 'Молчишь? Правильно, что тут скажешь... Вы с Санжаром прокололись по-крупному. Иди в ванную, смой с лица кровь.',
        duration: 4.8,
      },
      {
        speaker: 'system',
        text: 'АИ МОЛЧА НАПРАВЛЯЕТСЯ К РАКОВИНЕ В ВАННОЙ МОТЕЛЯ.',
        duration: 3.4,
      },
    ],
  },

  // 3. Marakulin Tower Assault Plan (Point of No Return — Linear Nonlinearity)
  assault_frontal: {
    choiceId: 'assault_frontal',
    momentId: 'tower_assault_plan',
    affinityDelta: 10,
    approach: 'frontal',
    lines: [
      {
        speaker: 'ai',
        text: 'Идём прямо через главный вход Маракулин Тауэр. Никаких обходных путей — пусть знают, кто пришёл.',
        duration: 4.5,
      },
      {
        speaker: 'samir',
        text: 'Пора развлечься как в 2026! Будем ебашить охрану и сотрудников мегакорпорации Маракулин до самого Хуеши!',
        duration: 5.2,
      },
    ],
  },
  assault_netrunner: {
    choiceId: 'assault_netrunner',
    momentId: 'tower_assault_plan',
    affinityDelta: 5,
    approach: 'netrunner',
    lines: [
      {
        speaker: 'ai',
        text: 'Загружаем бэкдор с ретранслятора Кибер-Тастака прямо в контур охраны башни. Глушим турели и режем протокол брони Смэшера.',
        duration: 5.0,
      },
      {
        speaker: 'samir',
        text: 'Умно, Аи. Турели в холле ослепли, а хром Рихарда просядет на 20%. Но в парадный вход всё равно заходим шумно — пора развлечься как в 2026!',
        duration: 5.5,
      },
    ],
  },
  assault_eblanhana: {
    choiceId: 'assault_eblanhana',
    momentId: 'tower_assault_plan',
    affinityDelta: 5,
    approach: 'eblanhana',
    lines: [
      {
        speaker: 'ai',
        text: 'Кибер-Ахмед, подгоняй тактический сброс к площади Маракулин Тауэр. Вся Ебланхана сегодня ставит на нас.',
        duration: 4.6,
      },
      {
        speaker: 'akhmed',
        text: 'Принято, брат! Полный комплект брони и свежие MaxDoc из антикафе «Марум» уже у входа. Порвите их за Санжара!',
        duration: 5.0,
      },
      {
        speaker: 'samir',
        text: 'С таким тылом можно штурмовать хоть весь Алматы. Пора развлечься как в 2026!',
        duration: 4.4,
      },
    ],
  },

  // 4. Smasher Execution Last Words
  smasher_for_sanzhar: {
    choiceId: 'smasher_for_sanzhar',
    momentId: 'smasher_execution',
    affinityDelta: 15,
    lines: [
      {
        speaker: 'ai',
        text: 'Это за Санжара... и за 2026 год, жестянка.',
        duration: 3.6,
      },
      {
        speaker: 'smasher',
        text: 'Жалкий... кусок... мяса... Маракулин... не прощает...',
        duration: 3.2,
      },
      {
        speaker: 'samir',
        text: 'Спусти курок Malorian, Аи. Закрой этот счёт навсегда.',
        duration: 3.6,
      },
    ],
  },
  smasher_hell_rodion: {
    choiceId: 'smasher_hell_rodion',
    momentId: 'smasher_execution',
    affinityDelta: 10,
    lines: [
      {
        speaker: 'ai',
        text: 'Передай привет Родиону в аду, Рихард. Ваша империя сгорела.',
        duration: 3.8,
      },
      {
        speaker: 'smasher',
        text: 'Системы... брони... отказ... Ты... не уйдёшь из Хуеши...',
        duration: 3.2,
      },
      {
        speaker: 'samir',
        text: 'Красивая точка. Давай, добей его из Malorian S-3516!',
        duration: 3.4,
      },
    ],
  },

  // 5. Cyberspace Ending defaults (use getCyberspaceFarewellLines for affinity-reactive farewells)
  ending_marum: {
    choiceId: 'ending_marum',
    momentId: 'cyberspace_ending',
    affinityDelta: 0,
    lines: [
      {
        speaker: 'ai',
        text: 'Я возвращаюсь в своё тело, Таисия. Даже если осталось полгода — я проживу их в Кибер-Алматы как легенда.',
        duration: 5.0,
      },
      {
        speaker: 'samir',
        text: 'Тогда не проеби эти полгода, брат. Забери антикафе «Марум» и держи Ебланхану на ушах.',
        duration: 5.0,
      },
    ],
  },
  ending_taldykorgan: {
    choiceId: 'ending_taldykorgan',
    momentId: 'cyberspace_ending',
    affinityDelta: 0,
    lines: [
      {
        speaker: 'ai',
        text: 'Забирай тело, Самир. У тебя впереди целая жизнь, а я уйду за Чёрный Заслон с Таисией.',
        duration: 5.0,
      },
      {
        speaker: 'samir',
        text: 'Я не забуду, что ты сделал, Амир. Уеду из Алматы подальше от корпов — в город-ад Талдыкорган. Прощай, кент.',
        duration: 5.5,
      },
    ],
  },
};

/**
 * Returns formatted branching choices for any narrative decision point.
 */
export function getBranchChoices(momentId: BranchMomentId, censored = false): DialogueChoice[] {
  return BRANCHING_CHOICES[momentId].choices.map((c) => ({
    ...c,
    text: formatDialogueText(c.text, censored),
    subtext: c.subtext ? formatDialogueText(c.subtext, censored) : undefined,
  }));
}

/**
 * Returns formatted response lines for a chosen branch option.
 */
export function getBranchResponseLines(choiceId: string, censored = false): DialogueLine[] {
  const response = BRANCH_RESPONSES[choiceId];
  if (!response) return [];
  return response.lines.map((line) => ({
    ...line,
    text: formatDialogueText(line.text, censored),
  }));
}

/**
 * Builds the 3-way Marakulin Tower Assault Plan choices with live Open-World unlock badges.
 */
export function getAssaultPlanChoices(options: {
  hasNetrunnerIntel: boolean;
  hasEblanhanaSupport: boolean;
  censored?: boolean;
}): DialogueChoice[] {
  const censored = Boolean(options.censored);
  const raw: DialogueChoice[] = [
    {
      id: 'assault_frontal',
      key: '1',
      text: '«Парадный прорыв («Как в 2026»)»',
      subtext: 'ДОСТУПНО ВСЕГДА // Прямой штурм холла Маракулин Тауэр с Самиром (Отношения +10)',
      affinityDelta: 10,
      approach: 'frontal',
    },
    {
      id: 'assault_netrunner',
      key: '2',
      text: '«Нетраннерский взлом башни»',
      subtext: options.hasNetrunnerIntel
        ? 'УСИЛЕНО [РЕТРАНСЛЯТОР ТАСТАКА] // Отключает турели холла и ослабляет броню Смэшера на 20%'
        : 'БАЗОВЫЙ ВЗЛОМ // Выполните заказ «Ретранслятор Тастака» для -20% брони Смэшера и отключения турелей',
      affinityDelta: 5,
      approach: 'netrunner',
    },
    {
      id: 'assault_eblanhana',
      key: '3',
      text: '«Поддержка Ебланханы и Кибер-Ахмеда»',
      subtext: options.hasEblanhanaSupport
        ? 'УСИЛЕНО [АВТОРИТЕТ ЕБЛАНХАНЫ] // Полная броня, +2 MaxDoc и тактический сброс Кибер-Ахмеда'
        : 'БАЗОВАЯ ПОДДЕРЖКА // Наберите REP ≥ 5 или выполните ≥2 заказа для полного сброса припасов',
      affinityDelta: 5,
      approach: 'eblanhana',
    },
  ];

  return raw.map((c) => ({
    ...c,
    text: formatDialogueText(c.text, censored),
    subtext: c.subtext ? formatDialogueText(c.subtext, censored) : undefined,
  }));
}

/**
 * Returns Samir & Taisiya's affinity-reactive farewell sequence in Хуеши Cyberspace.
 */
export function getCyberspaceFarewellLines(
  ending: 'marum' | 'taldykorgan',
  samirAffinity: number,
  censored = false,
): DialogueLine[] {
  const affinity = clampAffinity(samirAffinity);
  const lines: DialogueLine[] = [];

  if (ending === 'marum') {
    lines.push({
      speaker: 'taisiya',
      text: 'Разделение завершено. Сознание Аи возвращается в тело. Биологический лимит — ровно шесть месяцев.',
      duration: 4.8,
    });
    if (affinity >= 70) {
      lines.push({
        speaker: 'samir',
        text: 'Мы с тобой реально сожгли Маракулин Тауэр, Амир. Лучшего напарника в одной башке я и желать не мог. Сделай «Марум» легендой Ебланханы — за меня и за Санжара.',
        duration: 6.2,
      });
    } else if (affinity >= 40) {
      lines.push({
        speaker: 'samir',
        text: 'Ну что, Аи, это был жёсткий забег. Спорили мы часто, но Смэшера положили вместе. Не трать свои полгода впустую — держи Ебланхану.',
        duration: 5.6,
      });
    } else {
      lines.push({
        speaker: 'samir',
        text: 'Ты так до конца мне и не поверил, Амир... но башню мы всё равно разнесли. Живи свои полгода в «Маруме», а я растворюсь за Чёрным Заслоном.',
        duration: 5.8,
      });
    }
  } else {
    lines.push({
      speaker: 'taisiya',
      text: 'Передача тела подтверждена. Аи остаётся за Чёрным Заслоном. Самир получает полноценную жизнь.',
      duration: 4.8,
    });
    if (affinity >= 70) {
      lines.push({
        speaker: 'samir',
        text: 'Ты отдал мне второй шанс, брат... Клянусь, я проживу эту жизнь за двоих. Бросаю неоновый ад Алматы и уезжаю в Талдыкорган. Прощай, легенда.',
        duration: 6.2,
      });
    } else if (affinity >= 40) {
      lines.push({
        speaker: 'samir',
        text: 'Не ожидал, что ты реально уступишь тело, Аи. Спасибо, кент. Уеду из Кибер-Алматы в город-ад Талдыкорган и начну всё с чистого листа.',
        duration: 5.8,
      });
    } else {
      lines.push({
        speaker: 'samir',
        text: 'После всех наших стычек ты всё-таки отдал мне этот шанс... Прости за всё, Амир. Уезжаю в Талдыкорган — подальше от Маракулиных и призраков прошлого.',
        duration: 6.0,
      });
    }
  }

  return lines.map((line) => ({
    ...line,
    text: formatDialogueText(line.text, censored),
  }));
}

