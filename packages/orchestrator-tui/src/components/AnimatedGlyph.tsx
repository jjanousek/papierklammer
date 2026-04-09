import React, { useEffect, useState } from "react";
import { Text } from "ink";

type AnimationName = "thinking" | "waiting" | "activeRun";

const ANIMATIONS: Record<AnimationName, { frames: string[]; interval: number }> = {
  // Inspired by raw unicode frame sets such as helix/orbit-style braille animations.
  thinking: {
    frames: ["⠁⠂⠄⡀", "⠂⠄⡀⢀", "⠄⡀⢀⠠", "⡀⢀⠠⠐", "⢀⠠⠐⠈", "⠠⠐⠈⠁", "⠐⠈⠁⠂", "⠈⠁⠂⠄"],
    interval: 90,
  },
  waiting: {
    frames: ["⠇⠋", "⠙⠸", "⠴⠦", "⠧⠇", "⠋⠙", "⠸⠴"],
    interval: 80,
  },
  activeRun: {
    frames: ["⣀", "⣄", "⣤", "⣦", "⣶", "⣷", "⣿", "⣯", "⣟", "⡿", "⢿", "⣻", "⣽"],
    interval: 70,
  },
};

export interface AnimatedGlyphProps {
  name?: AnimationName;
}

export function AnimatedGlyph({
  name = "thinking",
}: AnimatedGlyphProps): React.ReactElement {
  const animation = ANIMATIONS[name];
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    setFrameIndex(0);
    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % animation.frames.length);
    }, animation.interval);

    return () => {
      clearInterval(timer);
    };
  }, [animation.frames.length, animation.interval]);

  return <Text>{animation.frames[frameIndex] ?? animation.frames[0] ?? "…"}</Text>;
}
