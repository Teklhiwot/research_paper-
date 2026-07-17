import Dexie, { type Table } from 'dexie';
import type {
  UserProfile,
  Exercise,
  WorkoutTemplate,
  WorkoutSession,
  WeightEntry,
  MeasurementEntry,
  ProgressPhoto,
  FastingSession,
  AppSettings,
  CardioSession,
  PersonalRecord,
} from '../types';

export class FitnessPWADB extends Dexie {
  userProfile!: Table<UserProfile>;
  exercises!: Table<Exercise>;
  workoutTemplates!: Table<WorkoutTemplate>;
  workoutSessions!: Table<WorkoutSession>;
  weightEntries!: Table<WeightEntry>;
  measurementEntries!: Table<MeasurementEntry>;
  progressPhotos!: Table<ProgressPhoto>;
  fastingSessions!: Table<FastingSession>;
  appSettings!: Table<AppSettings>;
  cardioSessions!: Table<CardioSession>;
  personalRecords!: Table<PersonalRecord>;

  constructor() {
    super('FitnessPWA');
    this.version(1).stores({
      userProfile: '++id',
      exercises: '++id, &name',
      workoutTemplates: '++id, &day',
      workoutSessions: '++id, date',
      weightEntries: '++id, date',
      measurementEntries: '++id, date',
      progressPhotos: '++id, date, type',
      fastingSessions: '++id, date',
      appSettings: '++id',
      cardioSessions: '++id, date',
      personalRecords: '++id, exerciseId, date',
    });
  }
}

export const db = new FitnessPWADB();

// Default exercises for the app
const DEFAULT_EXERCISES: Exercise[] = [
  // Chest
  { id: '1', name: 'Barbell Bench Press', muscleGroup: 'Chest' },
  { id: '2', name: 'Dumbbell Incline Press', muscleGroup: 'Chest' },
  { id: '3', name: 'Dumbbell Fly', muscleGroup: 'Chest' },
  { id: '4', name: 'Close Grip Bench Press', muscleGroup: 'Chest' },

  // Triceps
  { id: '5', name: 'Dumbbell Overhead Triceps Extension', muscleGroup: 'Triceps' },
  { id: '6', name: 'Triceps Pushdown', muscleGroup: 'Triceps' },

  // Back
  { id: '7', name: 'Deadlift', muscleGroup: 'Back' },
  { id: '8', name: 'Bent Over Barbell Row', muscleGroup: 'Back' },
  { id: '9', name: 'One Arm Dumbbell Row', muscleGroup: 'Back' },

  // Biceps
  { id: '10', name: 'Standing Dumbbell Curl', muscleGroup: 'Biceps' },
  { id: '11', name: 'Hammer Curl', muscleGroup: 'Biceps' },
  { id: '12', name: 'Barbell Curl', muscleGroup: 'Biceps' },

  // Legs
  { id: '13', name: 'Barbell Squat', muscleGroup: 'Legs' },
  { id: '14', name: 'Romanian Deadlift', muscleGroup: 'Legs' },
  { id: '15', name: 'Walking Lunges', muscleGroup: 'Legs' },
  { id: '16', name: 'Standing Dumbbell Calf Raise', muscleGroup: 'Legs' },

  // Shoulders
  { id: '17', name: 'Standing Barbell Overhead Press', muscleGroup: 'Shoulders' },
  { id: '18', name: 'Dumbbell Shoulder Press', muscleGroup: 'Shoulders' },
  { id: '19', name: 'Lateral Raise', muscleGroup: 'Shoulders' },
  { id: '20', name: 'Rear Delt Raise', muscleGroup: 'Shoulders' },
  { id: '21', name: 'Shrugs', muscleGroup: 'Shoulders' },

  // Abs
  { id: '22', name: 'Leg Raises', muscleGroup: 'Abs' },
  { id: '23', name: 'Reverse Crunch', muscleGroup: 'Abs' },
  { id: '24', name: 'Bicycle Crunch', muscleGroup: 'Abs' },
  { id: '25', name: 'Russian Twist', muscleGroup: 'Abs' },
  { id: '26', name: 'Front Plank', muscleGroup: 'Abs' },
  { id: '27', name: 'Side Plank', muscleGroup: 'Abs' },
];

// Initialize database with default data
export const initializeDatabase = async () => {
  const existingUserProfile = await db.userProfile.count();
  const existingExercises = await db.exercises.count();

  if (existingUserProfile === 0) {
    const userProfile: UserProfile = {
      id: '1',
      age: 30,
      height: 161,
      currentWeight: 82,
      targetWeight: 64,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    await db.userProfile.add(userProfile);
  }

  if (existingExercises === 0) {
    await db.exercises.bulkAdd(DEFAULT_EXERCISES);
  }

  const existingSettings = await db.appSettings.count();
  if (existingSettings === 0) {
    const defaultSettings: AppSettings = {
      id: '1',
      darkMode: window.matchMedia('(prefers-color-scheme: dark)').matches,
      notifications: {
        workoutReminder: true,
        waterReminder: true,
        fastingStart: true,
        fastingEnd: true,
        restTimer: true,
      },
      theme: 'auto',
      language: 'en',
    };
    await db.appSettings.add(defaultSettings);
  }
};

export default db;
