/**
 * SnakeGame — Playable Snake in the terminal.
 *
 * Controls: WASD to move · Space to pause · R to restart
 *
 * Uses a ref-backed game state with a single persistent interval so
 * the game loop never captures stale closure values.
 */

import { Box, Text } from 'ink';
import { useReducer, useRef, useEffect, useState } from 'react';
import { useScreenInput } from '../hooks/useScreenInput.js';
import { Colors } from '../styles.js';
import {
  getSnakeHighScore,
  setSnakeHighScore,
} from '../../../utils/ampli-settings.js';

const W = 20;
const H = 10;
const TICK_MS = 150;


type Point = { x: number; y: number };
type Dir = { dx: number; dy: number };

const DIRS = {
  up: { dx: 0, dy: -1 },
  down: { dx: 0, dy: 1 },
  left: { dx: -1, dy: 0 },
  right: { dx: 1, dy: 0 },
} as const;

function randomFood(snake: Point[]): Point {
  const free: Point[] = [];
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!snake.some((s) => s.x === x && s.y === y)) {
        free.push({ x, y });
      }
    }
  }
  return free[Math.floor(Math.random() * free.length)] ?? { x: 0, y: 0 };
}

type GameState = {
  snake: Point[];
  dir: Dir;
  dirQueue: Dir[];
  food: Point;
  score: number;
  gameOver: boolean;
  paused: boolean;
  started: boolean;
};

function makeInitial(): GameState {
  const snake = [
    { x: 10, y: 5 },
    { x: 9, y: 5 },
    { x: 8, y: 5 },
  ];
  return {
    snake,
    dir: DIRS.right,
    dirQueue: [],
    food: randomFood(snake),
    score: 0,
    gameOver: false,
    paused: false,
    started: false,
  };
}

interface SnakeGameProps {
  onExit?: () => void;
}

export const SnakeGame = ({ onExit }: SnakeGameProps = {}) => {
  const stateRef = useRef<GameState>(makeInitial());
  const [, forceUpdate] = useReducer((x: number) => x + 1, 0);

  const highScoreRef = useRef(0);
  const [highScore, setHighScore] = useState(0);

  useEffect(() => {
    const saved = getSnakeHighScore();
    highScoreRef.current = saved;
    setHighScore(saved);
  }, []);

  const reset = () => {
    stateRef.current = { ...makeInitial(), started: true };
    forceUpdate();
  };

  // Single persistent interval — reads from ref to avoid stale closures
  useEffect(() => {
    const id = setInterval(() => {
      const g = stateRef.current;
      if (!g.started || g.gameOver || g.paused) return;

      // Consume next queued direction if available
      const [nextDir, ...restQueue] = g.dirQueue.length > 0 ? g.dirQueue : [g.dir];
      const dir = nextDir;

      const head = { x: g.snake[0].x + dir.dx, y: g.snake[0].y + dir.dy };

      if (
        head.x < 0 ||
        head.x >= W ||
        head.y < 0 ||
        head.y >= H ||
        g.snake.some((s) => s.x === head.x && s.y === head.y)
      ) {
        stateRef.current = { ...g, dir, dirQueue: restQueue, gameOver: true };
        forceUpdate();
        return;
      }

      const ate = head.x === g.food.x && head.y === g.food.y;
      const snake = ate ? [head, ...g.snake] : [head, ...g.snake.slice(0, -1)];
      const newScore = ate ? g.score + 1 : g.score;

      if (ate && newScore > highScoreRef.current) {
        highScoreRef.current = newScore;
        setSnakeHighScore(newScore);
        setHighScore(newScore);
      }

      stateRef.current = {
        ...g,
        snake,
        dir,
        dirQueue: restQueue,
        food: ate ? randomFood(snake) : g.food,
        score: newScore,
      };
      forceUpdate();
    }, TICK_MS);

    return () => clearInterval(id);
  }, []);

  useScreenInput((input) => {
    const g = stateRef.current;

    if (input === 'q' && onExit) {
      onExit();
      return;
    }

    if (!g.started || g.gameOver) {
      if (input === 'r' || input === ' ') reset();
      return;
    }

    if (input === ' ') {
      stateRef.current = { ...g, paused: !g.paused };
      forceUpdate();
      return;
    }

    if (input === 'r') {
      reset();
      return;
    }

    // Check 180° against the last queued direction (or current if queue is empty)
    const lastDir = g.dirQueue[g.dirQueue.length - 1] ?? g.dir;
    let next: Dir | null = null;
    if (input === 'w' && lastDir.dy !== 1) next = DIRS.up;
    else if (input === 's' && lastDir.dy !== -1) next = DIRS.down;
    else if (input === 'a' && lastDir.dx !== 1) next = DIRS.left;
    else if (input === 'd' && lastDir.dx !== -1) next = DIRS.right;
    // Cap queue at 2 to avoid buffering too far ahead
    if (next && g.dirQueue.length < 2) {
      stateRef.current = { ...g, dirQueue: [...g.dirQueue, next] };
    }
  });

  const { snake, food, score, gameOver, paused, started } = stateRef.current;

  const cells = Array.from({ length: H }, (_, y) =>
    Array.from({ length: W }, (_, x) => {
      if (x === snake[0]?.x && y === snake[0]?.y) return 'head';
      if (snake.some((s) => s.x === x && s.y === y)) return 'body';
      if (x === food.x && y === food.y) return 'food';
      return 'empty';
    }),
  );

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box gap={2}>
        <Text bold color={Colors.accent}>
          Snake
        </Text>
        <Text dimColor>
          Score: <Text bold>{score}</Text>
        </Text>
        {highScore > 0 && (
          <Text dimColor>
            Best: <Text bold>{highScore}</Text>
          </Text>
        )}
        {paused && <Text color="yellow"> PAUSED</Text>}
      </Box>
      <Box height={1} />
      <Box flexDirection="column">
        <Text dimColor>{'┌' + '──'.repeat(W) + '┐'}</Text>
        {cells.map((row, y) => (
          <Box key={y}>
            <Text dimColor>│</Text>
            {row.map((cell, x) => {
              if (cell === 'head') return <Text key={x} color="#f7a8b8" bold>{'◉ '}</Text>;
              if (cell === 'body') return <Text key={x} color="#ffffff">{'● '}</Text>;
              if (cell === 'food') return <Text key={x} color="#55cdfc">{'◆ '}</Text>;
              return <Text key={x} dimColor>{'· '}</Text>;
            })}
            <Text dimColor>│</Text>
          </Box>
        ))}
        <Text dimColor>{'└' + '──'.repeat(W) + '┘'}</Text>
      </Box>
      <Box height={1} />
      {!started && (
        <Text dimColor>
          Press <Text bold color={Colors.accent}>Space</Text> or{' '}
          <Text bold color={Colors.accent}>R</Text> to start
        </Text>
      )}
      {gameOver && (
        <Text>
          <Text color="red">Game over! </Text>
          <Text dimColor>Press </Text>
          <Text bold color={Colors.accent}>R</Text>
          <Text dimColor> to restart</Text>
        </Text>
      )}
      {started && !gameOver && (
        <Text dimColor>WASD to move · Space to pause · R to restart</Text>
      )}
      {onExit && (
        <Text dimColor>
          Press <Text bold>Q</Text> to return to the wizard
        </Text>
      )}
    </Box>
  );
};
