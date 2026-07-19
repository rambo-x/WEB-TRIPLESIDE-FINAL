import React, { createContext, useContext, useEffect, useRef, useState } from "react";

const AudioContext = createContext(null);

export const AudioProvider = ({ children }) => {
  const audioRef = useRef(typeof Audio !== "undefined" ? new Audio() : null);
  const [current, setCurrent] = useState(null); // {id, title, artist, audio_url, cover_url}
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);

  useEffect(() => {
    const a = audioRef.current;
    if (!a) return;
    const onTime = () => setProgress(a.currentTime || 0);
    const onDur = () => setDuration(a.duration || 0);
    const onEnd = () => setPlaying(false);
    a.addEventListener("timeupdate", onTime);
    a.addEventListener("loadedmetadata", onDur);
    a.addEventListener("ended", onEnd);
    return () => {
      a.removeEventListener("timeupdate", onTime);
      a.removeEventListener("loadedmetadata", onDur);
      a.removeEventListener("ended", onEnd);
    };
  }, []);

  const playTrack = (track) => {
    const a = audioRef.current;
    if (!a) return;
    if (current?.id === track.id) {
      if (a.paused) {
        a.play();
        setPlaying(true);
      } else {
        a.pause();
        setPlaying(false);
      }
      return;
    }
    a.src = track.audio_url;
    a.play().then(() => setPlaying(true)).catch(() => setPlaying(false));
    setCurrent(track);
  };

  const toggle = () => {
    const a = audioRef.current;
    if (!a || !current) return;
    if (a.paused) {
      a.play();
      setPlaying(true);
    } else {
      a.pause();
      setPlaying(false);
    }
  };

  const seek = (sec) => {
    const a = audioRef.current;
    if (!a) return;
    a.currentTime = sec;
    setProgress(sec);
  };

  const stop = () => {
    const a = audioRef.current;
    if (!a) return;
    a.pause();
    a.currentTime = 0;
    setPlaying(false);
    setCurrent(null);
  };

  return (
    <AudioContext.Provider value={{ current, playing, progress, duration, playTrack, toggle, seek, stop }}>
      {children}
    </AudioContext.Provider>
  );
};

export const useAudio = () => useContext(AudioContext);
