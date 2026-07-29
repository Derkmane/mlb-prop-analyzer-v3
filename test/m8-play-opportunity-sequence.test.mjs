import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildM8PlayOpportunitySequence,
} from '../scripts/m8-context-play-signature-audit-run-utils.mjs';

function play({
  gameId = 5057773,
  order,
  type,
  batterId = null,
  pitcherId = 2274,
  inning = 4,
  inningType = 'Bottom',
  outs = 0,
  text = null,
}) {
  return {
    game_id: gameId,
    order,
    type,
    text,
    inning,
    inning_type: inningType,
    outs,
    batter_id: batterId,
    pitcher_id: pitcherId,
  };
}

function completeSegment({
  gameId = 9001,
  startOrder,
  batterId,
  pitcherId = 20,
  inning = 1,
  inningType = 'Top',
}) {
  return [
    play({
      gameId,
      order: startOrder,
      type: 'Start Batter/Pitcher',
      batterId,
      pitcherId,
      inning,
      inningType,
    }),
    play({
      gameId,
      order: startOrder + 1,
      type: 'Single',
      batterId,
      pitcherId,
      inning,
      inningType,
      text: 'Pitch in play.',
    }),
    play({
      gameId,
      order: startOrder + 2,
      type: 'Play Result',
      batterId,
      pitcherId,
      inning,
      inningType,
      text: `Batter ${batterId} singled.`,
    }),
    play({
      gameId,
      order: startOrder + 3,
      type: 'End Batter/Pitcher',
      batterId,
      pitcherId,
      inning,
      inningType,
    }),
  ];
}

test(
  'preserves the known omitted intentional-walk opportunity',
  () => {
    const plays = [
      play({
        order: 64421355,
        type: 'Start Batter/Pitcher',
        batterId: 266,
        outs: 2,
        text:
          'Sean Newcomb pitches to Brice Turang',
      }),
      play({
        order: 64422361,
        type: 'Ground Out',
        batterId: 266,
        outs: 2,
        text: 'Pitch 1 : Ball In Play',
      }),
      play({
        order: 64422362,
        type: 'Play Result',
        batterId: 266,
        outs: 2,
        text:
          'Turang grounded out to second, Ortiz to second.',
      }),
      play({
        order: 64422363,
        type: 'End Batter/Pitcher',
        batterId: 266,
        outs: 2,
      }),

      play({
        order: 64422364,
        type: 'Start Batter/Pitcher',
        batterId: 168,
        outs: 2,
        text:
          'Sean Newcomb pitches to William Contreras',
      }),
      play({
        order: 64422365,
        type: 'Automatic Ball - IBB',
        batterId: 168,
        outs: 2,
        text:
          'Pitch 1 : Automatic Ball - IBB 1',
      }),
      play({
        order: 64422366,
        type: 'Automatic Ball - IBB',
        batterId: 168,
        outs: 2,
        text:
          'Pitch 2 : Automatic Ball - IBB 2',
      }),
      play({
        order: 64422367,
        type: 'Automatic Ball - IBB',
        batterId: 168,
        outs: 2,
        text:
          'Pitch 3 : Automatic Ball - IBB 3',
      }),
      play({
        order: 64422368,
        type: 'Automatic Ball - IBB',
        batterId: 168,
        outs: 2,
        text:
          'Pitch 4 : Automatic Ball - IBB 4',
      }),
      play({
        order: 64422369,
        type: 'Play Result',
        batterId: 168,
        outs: 2,
        text:
          'Contreras intentionally walked.',
      }),
      play({
        order: 64422370,
        type: 'End Batter/Pitcher',
        batterId: 168,
        outs: 2,
      }),

      play({
        order: 64422371,
        type: 'Start Batter/Pitcher',
        batterId: 1956,
        outs: 3,
        text:
          'Sean Newcomb pitches to Christian Yelich',
      }),
      play({
        order: 64424998,
        type: 'Single',
        batterId: 1956,
        outs: 3,
        text: 'Pitch 4 : Ball In Play',
      }),
      play({
        order: 64424999,
        type: 'Play Result',
        batterId: 1956,
        outs: 3,
        text:
          'Yelich singled to center, Ortiz scored, Contreras thrown out at third.',
      }),
      play({
        order: 64425000,
        type: 'End Batter/Pitcher',
        batterId: 1956,
        outs: 3,
      }),
    ];

    const result =
      buildM8PlayOpportunitySequence({
        gameId: 5057773,
        plays,
      });

    assert.deepEqual(
      result.opportunities.map(
        (opportunity) =>
          opportunity.batterId,
      ),
      [266, 168, 1956],
    );

    const intentionalWalk =
      result.opportunities[1];

    assert.equal(
      intentionalWalk.batterId,
      168,
    );

    assert.equal(
      intentionalWalk.sideOpportunityIndex,
      2,
    );

    assert.deepEqual(
      intentionalWalk.batterResultTexts,
      ['Contreras intentionally walked.'],
    );

    assert.equal(
      intentionalWalk.playTypes.filter(
        (type) =>
          type ===
          'Automatic Ball - IBB',
      ).length,
      4,
    );

    const paEndpointBatterIds = [
      266,
      1956,
    ];

    assert.equal(
      paEndpointBatterIds.includes(168),
      false,
    );
  },
);

test(
  'assigns deterministic lineup slots and turns from complete play opportunities',
  () => {
    const plays = Array.from(
      { length: 10 },
      (_, index) =>
        completeSegment({
          gameId: 9001,
          startOrder:
            1 + index * 10,
          batterId:
            100 + (index % 9),
        }),
    ).flat();

    const result =
      buildM8PlayOpportunitySequence({
        gameId: 9001,
        plays,
      });

    assert.deepEqual(
      result.opportunities.map(
        (opportunity) =>
          opportunity.lineupSlot,
      ),
      [
        1, 2, 3, 4, 5,
        6, 7, 8, 9, 1,
      ],
    );

    assert.deepEqual(
      result.opportunities.map(
        (opportunity) =>
          opportunity.lineupTurn,
      ),
      [
        1, 1, 1, 1, 1,
        1, 1, 1, 1, 2,
      ],
    );

    assert.deepEqual(
      result.opportunityCountByHalf,
      {
        top: 10,
        bottom: 0,
      },
    );
  },
);

test(
  'fails closed when a batter segment lacks terminal evidence',
  () => {
    const plays = [
      play({
        gameId: 9002,
        order: 1,
        type: 'Start Batter/Pitcher',
        batterId: 10,
        pitcherId: 20,
        inningType: 'Top',
      }),
      play({
        gameId: 9002,
        order: 2,
        type: 'Automatic Ball - IBB',
        batterId: 10,
        pitcherId: 20,
        inningType: 'Top',
      }),
      play({
        gameId: 9002,
        order: 3,
        type: 'End Batter/Pitcher',
        batterId: 10,
        pitcherId: 20,
        inningType: 'Top',
      }),
    ];

    assert.throws(
      () =>
        buildM8PlayOpportunitySequence({
          gameId: 9002,
          plays,
        }),
      /lacks batter-matched terminal evidence/,
    );
  },
);


test(
  'ignores a delayed foreign-context row while preserving one complete opportunity',
  () => {
    const plays = [
      play({
        gameId: 9003,
        order: 1,
        type: 'Start Batter/Pitcher',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
      }),
      play({
        gameId: 9003,
        order: 2,
        type: 'Ball',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
      }),
      play({
        gameId: 9003,
        order: 3,
        type: 'Foul Ball',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
      }),
      play({
        gameId: 9003,
        order: 4,
        type: 'Strike Swinging',
        batterId: 318,
        pitcherId: 223389,
        inning: 2,
        inningType: 'Bottom',
      }),
      play({
        gameId: 9003,
        order: 5,
        type: 'Ball',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
      }),
      play({
        gameId: 9003,
        order: 6,
        type: 'Ball',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
      }),
      play({
        gameId: 9003,
        order: 7,
        type: 'Ball',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
      }),
      play({
        gameId: 9003,
        order: 8,
        type: 'Play Result',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
        text: 'Vargas walked.',
      }),
      play({
        gameId: 9003,
        order: 9,
        type: 'End Batter/Pitcher',
        batterId: 771,
        pitcherId: 1056,
        inning: 8,
        inningType: 'Top',
      }),
    ];

    const result =
      buildM8PlayOpportunitySequence({
        gameId: 9003,
        plays,
      });

    assert.equal(
      result.opportunityCount,
      1,
    );

    const opportunity =
      result.opportunities[0];

    assert.equal(
      opportunity.batterId,
      771,
    );

    assert.equal(
      opportunity.startOrder,
      1,
    );

    assert.equal(
      opportunity.endOrder,
      9,
    );

    assert.deepEqual(
      opportunity.batterResultTexts,
      ['Vargas walked.'],
    );

    assert.deepEqual(
      opportunity.playTypes,
      [
        'Start Batter/Pitcher',
        'Ball',
        'Foul Ball',
        'Ball',
        'Ball',
        'Ball',
        'Play Result',
        'End Batter/Pitcher',
      ],
    );

    assert.equal(
      opportunity.playTypes.includes(
        'Strike Swinging',
      ),
      false,
    );
  },
);


test(
  'defers a premature inning boundary until delayed terminal evidence arrives',
  () => {
    const plays = [
      play({
        gameId: 9004,
        order: 1,
        type: 'Start Batter/Pitcher',
        batterId: 244,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
      }),
      play({
        gameId: 9004,
        order: 2,
        type: 'Ball',
        batterId: 244,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
      }),
      play({
        gameId: 9004,
        order: 3,
        type: 'Stolen Base',
        batterId: null,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
        text: 'Runner stole second.',
      }),
      play({
        gameId: 9004,
        order: 4,
        type: 'Ball',
        batterId: 244,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
      }),
      play({
        gameId: 9004,
        order: 5,
        type: 'End Inning',
        batterId: null,
        pitcherId: null,
        inning: 5,
        inningType: 'End',
        text: 'End of the 5th inning',
      }),
      play({
        gameId: 9004,
        order: 6,
        type: 'Play Result',
        batterId: null,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
        text: 'Runner stole second.',
      }),
      play({
        gameId: 9004,
        order: 7,
        type: 'Ground Out',
        batterId: 244,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
      }),
      play({
        gameId: 9004,
        order: 8,
        type: 'Play Result',
        batterId: 244,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
        text: 'Garcia grounded out to third.',
      }),
      play({
        gameId: 9004,
        order: 9,
        type: 'End Batter/Pitcher',
        batterId: 244,
        pitcherId: 2142,
        inning: 5,
        inningType: 'Bottom',
      }),
    ];

    const result =
      buildM8PlayOpportunitySequence({
        gameId: 9004,
        plays,
      });

    assert.equal(
      result.opportunityCount,
      1,
    );

    const opportunity =
      result.opportunities[0];

    assert.equal(
      opportunity.batterId,
      244,
    );

    assert.equal(
      opportunity.startOrder,
      1,
    );

    assert.equal(
      opportunity.endOrder,
      9,
    );

    assert.deepEqual(
      opportunity.batterResultTexts,
      ['Garcia grounded out to third.'],
    );

    assert.deepEqual(
      opportunity.playTypes,
      [
        'Start Batter/Pitcher',
        'Ball',
        'Stolen Base',
        'Ball',
        'Play Result',
        'Ground Out',
        'Play Result',
        'End Batter/Pitcher',
      ],
    );

    assert.equal(
      opportunity.playTypes.includes(
        'End Inning',
      ),
      false,
    );
  },
);
