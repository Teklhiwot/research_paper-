// User Profile
export interface UserProfile {
  id: string;
  age: number;
  height: number; // cm
  currentWeight: number; // kg
  targetWeight: number; // kg
  createdAt: Date;
  updatedAt: Date;
}

// Exercise
export interface Exercise {
  id: string;
  name: string;
  muscleGroup: string;
  description?: string;
}

// Workout Template
export interface WorkoutTemplate {
  id: string;
  day: string; // Monday, Tuesday, etc.
  name: string;
  exercises: WorkoutExercise[];
}

// Workout Exercise Details
export interface WorkoutExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  sets: number;
  reps: string | number; // Can be "8-10" or just "8"
  weight?: number; // kg
  notes?: string;
  order: number;
  completed?: boolean;
}

// Workout Session (Logged workout)
export interface WorkoutSession {
  id: string;
  date: Date;
  dayOfWeek: string;
  template?: string; // Name of template used
  exercises: LoggedExercise[];
  totalDuration?: number; // minutes
  notes?: string;
  completed: boolean;
}

// Logged Exercise (One exercise within a session)
export interface LoggedExercise {
  id: string;
  exerciseId: string;
  exerciseName: string;
  muscleGroup: string;
  sets: LoggedSet[];
  notes?: string;
  completed: boolean;
}

// Logged Set (One set of an exercise)
export interface LoggedSet {
  id: string;
  setNumber: number;
  reps: number;
  weight: number; // kg
  rpe?: number; // Rate of Perceived Exertion (1-10)
  notes?: string;
  completed: boolean;
}

// Personal Record
export interface PersonalRecord {
  id: string;
  exerciseId: string;
  exerciseName: string;
  weight: number; // kg
  reps: number;
  sets: number;
  date: Date;
}

// Weight Entry
export interface WeightEntry {
  id: string;
  date: Date;
  weight: number; // kg
  notes?: string;
}

// Measurement Entry
export interface MeasurementEntry {
  id: string;
  date: Date;
  waist?: number; // cm
  chest?: number; // cm
  neck?: number; // cm
  arms?: number; // cm
  thighs?: number; // cm
  calves?: number; // cm
  notes?: string;
}

// Progress Photo
export interface ProgressPhoto {
  id: string;
  date: Date;
  type: 'front' | 'side' | 'back'; // Photo angle
  imageData: string; // Base64 encoded image
  notes?: string;
}

// Fasting Session
export interface FastingSession {
  id: string;
  date: Date;
  startTime: Date;
  endTime?: Date;
  hoursCompleted?: number;
  type: '18:6' | 'omad' | 'custom';
  completed: boolean;
}

// Statistics
export interface Statistics {
  workoutStreak: number;
  longestStreak: number;
  totalWorkouts: number;
  workoutCompletionPercentage: number;
  totalTrainingVolume: number; // sets × reps × weight
  caloriesBurned?: number;
  weightLost: number; // kg
}

// Settings
export interface AppSettings {
  id: string;
  darkMode: boolean;
  notifications: {
    workoutReminder: boolean;
    waterReminder: boolean;
    fastingStart: boolean;
    fastingEnd: boolean;
    restTimer: boolean;
  };
  workoutReminderTime?: string; // HH:mm format
  theme: 'light' | 'dark' | 'auto';
  language: string;
}

// Cardio Session (Optional tracking)
export interface CardioSession {
  id: string;
  date: Date;
  type: 'walk' | 'jog' | 'run' | 'hiit' | 'other';
  duration: number; // minutes
  distance?: number; // km
  caloriesBurned?: number;
  notes?: string;
}
