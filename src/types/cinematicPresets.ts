export interface CinematicPreset {
  id: number;
  label: string;
  value: string;
  video: string;
  promptKey: string;
}

export const cinematicPresets: CinematicPreset[] = [
  {
    id: 1,
    label: "Debut",
    value: "Truck left,Push in,Pan right",
    video: "/video/compressed_debut.mp4",
    promptKey: "debut_movement",
  },
  {
    id: 2,
    label: "Freedom",
    value: "Push out,Pedestal up,Tilt down",
    video: "/video/compressed_freedom.mp4",
    promptKey: "freedom_movement",
  },
  {
    id: 3,
    label: "Right circling",
    value: "Truck right,Pan left,Tracking shot",
    video: "/video/rightcircling_360w_optimized_2.mp4",
    promptKey: "right_circling",
  },
  {
    id: 4,
    label: "Left circling",
    value: "Truck left,Pan right,Tracking shot",
    video: "/video/leftcircling_360w_optimized_2.mp4",
    promptKey: "left_circling",
  },
  {
    id: 5,
    label: "Upward tilt",
    value: "Push in,Pedestal up",
    video: "/video/upwardtilt_360w_optimized_2.mp4",
    promptKey: "upward_tilt",
  },
  {
    id: 6,
    label: "Left walking",
    value: "Truck left,Tracking shot",
    video: "/video/leftwalking_360w_optimized_2.mp4",
    promptKey: "left_walking",
  },
  {
    id: 7,
    label: "Right walking",
    value: "Truck right,Tracking shot",
    video: "/video/rightwalking_360w_optimized_2.mp4",
    promptKey: "right_walking",
  },
  {
    id: 8,
    label: "Downward tilt",
    value: "Pedestal down,Tilt up",
    video: "/video/downwardtilt_360w_optimized_2.mp4",
    promptKey: "downward_tilt",
  },
  {
    id: 9,
    label: "Stage left",
    value: "Pan left,Zoom in",
    video: "/video/stageleft_360w_optimized_2.mp4",
    promptKey: "stage_left",
  },
  {
    id: 10,
    label: "Stage right",
    value: "Pan right,Zoom in",
    video: "/video/stageright_360w_optimized_2.mp4",
    promptKey: "stage_right",
  },
  {
    id: 11,
    label: "Scenic shot",
    value: "Truck left,Pedestal up",
    video: "/video/scenicshot_360w_optimized_2.mp4",
    promptKey: "scenic_shot",
  },
];
