self.onmessage = (e) => {
  const { type, data } = e.data;

  if (type === "PROCESS_FFT") {
    const array = data; // Uint8Array or Array of numbers
    if (!array || array.length === 0) return;

    // Calculate Bass (lower 20% of the frequency spectrum)
    const bassEnd = Math.floor(array.length * 0.2);
    let bassSum = 0;
    for (let i = 0; i < bassEnd; i++) {
      bassSum += array[i];
    }
    const bassAvg = bassEnd > 0 ? bassSum / bassEnd : 0;
    const bassScale = bassAvg / 255; // Normalized 0-1

    // Calculate Treble (upper 50% of the frequency spectrum)
    const trebleStart = Math.floor(array.length * 0.5);
    let trebleSum = 0;
    for (let i = trebleStart; i < array.length; i++) {
      trebleSum += array[i];
    }
    const trebleCount = array.length - trebleStart;
    const trebleAvg = trebleCount > 0 ? trebleSum / trebleCount : 0;
    const trebleShift = trebleAvg / 255; // Normalized 0-1

    self.postMessage({
      type: "VISUALIZER_DATA",
      payload: {
        bassScale,
        trebleShift,
      },
    });
  }
};
