import { useEffect, useState } from 'react';
import { useForm } from 'react-hook-form';
import { db } from '../database/db';
import type { WorkoutSession, LoggedExercise, Exercise } from '../types';
import { formatDate, getDayOfWeek, getToday, formatDurationShort } from '../utils/helpers';
import { useTimer, useStopwatch } from '../hooks';
import { 
  CheckCircleIcon, 
  XCircleIcon,
} from '../components/Icons';

export default function Workout() {
  const [workoutSession, setWorkoutSession] = useState<WorkoutSession | null>(null);
  const [allExercises, setAllExercises] = useState<Exercise[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [showRestTimer, setShowRestTimer] = useState(false);
  
  const restTimer = useTimer(60);
  const sessionStopwatch = useStopwatch();

  const { register, handleSubmit, setValue } = useForm({
    defaultValues: {
      exerciseName: '',
      sets: 3,
      reps: 10,
      weight: 0,
    },
  });

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setIsLoading(true);

      // Load all exercises
      const exercises = await db.exercises.toArray();
      setAllExercises(exercises);

      // Load or create today's workout
      const today = getToday();
      const allSessions = await db.workoutSessions.orderBy('date').toArray();
      const todayWorkouts = allSessions.filter(
        w => new Date(w.date).toDateString() === today.toDateString()
      );

      if (todayWorkouts.length > 0) {
        setWorkoutSession(todayWorkouts[0]);
        if (!todayWorkouts[0].completed) {
          sessionStopwatch.start();
        }
      } else {
        // Create a new workout session
        const newSession: WorkoutSession = {
          id: `workout-${Date.now()}`,
          date: new Date(),
          dayOfWeek: getDayOfWeek(),
          exercises: [],
          completed: false,
        };
        setWorkoutSession(newSession);
      }
    } catch (error) {
      console.error('Failed to load workout data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const addExercise = async (exerciseName: string, sets: number, reps: string | number, weight: number) => {
    if (!workoutSession) return;

    const exercise = allExercises.find(e => e.name === exerciseName);
    if (!exercise) return;

    const newExercise: LoggedExercise = {
      id: `exercise-${Date.now()}`,
      exerciseId: exercise.id,
      exerciseName: exercise.name,
      muscleGroup: exercise.muscleGroup,
      sets: Array.from({ length: sets }, (_, i) => ({
        id: `set-${i}-${Date.now()}`,
        setNumber: i + 1,
        reps: Number(reps),
        weight: weight,
        completed: false,
      })),
      completed: false,
    };

    const updated = {
      ...workoutSession,
      exercises: [...workoutSession.exercises, newExercise],
    };

    setWorkoutSession(updated);
    setValue('exerciseName', '');
    setValue('sets', 3);
    setValue('reps', 10);
    setValue('weight', 0);
  };

  const updateSet = (exerciseIndex: number, setIndex: number, completed: boolean) => {
    if (!workoutSession) return;

    const updated = { ...workoutSession };
    updated.exercises[exerciseIndex].sets[setIndex].completed = completed;

    // Check if all sets are complete
    const allSetComplete = updated.exercises[exerciseIndex].sets.every(s => s.completed);
    updated.exercises[exerciseIndex].completed = allSetComplete;

    setWorkoutSession(updated);

    // Show rest timer if set is completed
    if (completed && setIndex < updated.exercises[exerciseIndex].sets.length - 1) {
      setShowRestTimer(true);
      restTimer.reset(90); // Default 90 seconds rest
      restTimer.start();
    }
  };

  const completeWorkout = async () => {
    if (!workoutSession) return;

    const completed = workoutSession.exercises.length > 0 && 
                     workoutSession.exercises.every(e => e.completed);

    const sessionToSave: WorkoutSession = {
      ...workoutSession,
      completed: completed,
      totalDuration: sessionStopwatch.seconds,
    };

    try {
      await db.workoutSessions.put(sessionToSave);
      sessionStopwatch.stop();
      setWorkoutSession(sessionToSave);
      
      // Show success message
      alert('Workout completed! Great job! 💪');
    } catch (error) {
      console.error('Failed to save workout:', error);
      alert('Failed to save workout');
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-white dark:bg-slate-950">
        <div className="text-center">
          <div className="w-12 h-12 rounded-full border-4 border-slate-300 dark:border-slate-700 border-t-blue-600 dark:border-t-blue-400 animate-spin mx-auto mb-4"></div>
          <p className="text-slate-600 dark:text-slate-400">Loading workout...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        {/* Header with Timer */}
        <div className="mb-8">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white">
                Workout
              </h1>
              <p className="text-slate-600 dark:text-slate-400 mt-1">
                {formatDate(new Date())} • {getDayOfWeek()}
              </p>
            </div>
            <div className="text-right">
              <div className="text-4xl font-bold text-blue-600 dark:text-blue-400">
                {formatDurationShort(sessionStopwatch.seconds)}
              </div>
              <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                {sessionStopwatch.isRunning ? 'In Progress' : 'Paused'}
              </p>
            </div>
          </div>
        </div>

        {/* Add Exercise Form */}
        <div className="card-lg mb-8">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-6">
            Add Exercise
          </h2>

          <form onSubmit={handleSubmit((data) => 
            addExercise(data.exerciseName, data.sets, data.reps, data.weight)
          )} className="space-y-4">
            <div>
              <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                Exercise
              </label>
              <select
                {...register('exerciseName', { required: true })}
                className="input-field"
              >
                <option value="">Select an exercise...</option>
                {allExercises.map(exercise => (
                  <option key={exercise.id} value={exercise.name}>
                    {exercise.name} ({exercise.muscleGroup})
                  </option>
                ))}
              </select>
            </div>

            <div className="grid grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Sets
                </label>
                <input
                  type="number"
                  {...register('sets', { min: 1 })}
                  className="input-field"
                  min="1"
                  max="10"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Reps
                </label>
                <input
                  type="text"
                  {...register('reps')}
                  placeholder="10"
                  className="input-field"
                />
              </div>

              <div>
                <label className="block text-sm font-semibold text-slate-700 dark:text-slate-300 mb-2">
                  Weight (kg)
                </label>
                <input
                  type="number"
                  {...register('weight', { min: 0 })}
                  className="input-field"
                  min="0"
                  step="0.5"
                />
              </div>
            </div>

            <button type="submit" className="btn-primary w-full">
              Add Exercise
            </button>
          </form>
        </div>

        {/* Exercises List */}
        <div className="space-y-4 mb-8">
          {workoutSession?.exercises.length === 0 ? (
            <div className="card-lg text-center py-12">
              <p className="text-slate-600 dark:text-slate-400 mb-4">
                No exercises added yet. Add one to get started!
              </p>
            </div>
          ) : (
            workoutSession?.exercises.map((exercise, exerciseIdx) => (
              <div key={exercise.id} className="card-lg">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-xl font-bold text-slate-900 dark:text-white">
                      {exercise.exerciseName}
                    </h3>
                    <p className="text-sm text-slate-600 dark:text-slate-400">
                      {exercise.muscleGroup} • {exercise.sets.length} sets
                    </p>
                  </div>
                  {exercise.completed && (
                    <CheckCircleIcon className="w-6 h-6 text-green-500" />
                  )}
                </div>

                {/* Sets */}
                <div className="space-y-2">
                  {exercise.sets.map((set, setIdx) => (
                    <div
                      key={set.id}
                      className={`flex items-center justify-between p-3 rounded-lg transition-colors ${
                        set.completed
                          ? 'bg-green-50 dark:bg-green-900/20'
                          : 'bg-slate-100 dark:bg-slate-800'
                      }`}
                    >
                      <div className="flex-1">
                        <p className="text-sm font-semibold text-slate-900 dark:text-white">
                          Set {set.setNumber}: {set.reps} reps @ {set.weight}kg
                        </p>
                        {set.notes && (
                          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
                            {set.notes}
                          </p>
                        )}
                      </div>
                      <button
                        onClick={() => updateSet(exerciseIdx, setIdx, !set.completed)}
                        className={`ml-4 p-2 rounded-lg transition-colors ${
                          set.completed
                            ? 'bg-green-500 text-white'
                            : 'bg-slate-300 dark:bg-slate-700 text-slate-900 dark:text-slate-100'
                        }`}
                      >
                        {set.completed ? (
                          <CheckCircleIcon className="w-5 h-5" />
                        ) : (
                          <XCircleIcon className="w-5 h-5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        {/* Rest Timer Modal */}
        {showRestTimer && (
          <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
            <div className="card-lg max-w-md w-full">
              <h2 className="text-2xl font-bold text-slate-900 dark:text-white text-center mb-6">
                Rest Timer
              </h2>

              <div className="text-6xl font-bold text-blue-600 dark:text-blue-400 text-center mb-8">
                {formatDurationShort(restTimer.seconds)}
              </div>

              <div className="flex gap-3">
                <button
                  onClick={() => {
                    if (restTimer.isRunning) {
                      restTimer.pause();
                    } else {
                      restTimer.start();
                    }
                  }}
                  className="flex-1 btn-primary"
                >
                  {restTimer.isRunning ? 'Pause' : 'Resume'}
                </button>
                <button
                  onClick={() => {
                    restTimer.reset(90);
                    setShowRestTimer(false);
                  }}
                  className="flex-1 btn-secondary"
                >
                  Done
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3">
          <button
            onClick={() => {
              if (sessionStopwatch.isRunning) {
                sessionStopwatch.stop();
              } else {
                sessionStopwatch.start();
              }
            }}
            className="flex-1 btn-secondary"
          >
            {sessionStopwatch.isRunning ? 'Pause Workout' : 'Resume Workout'}
          </button>
          <button
            onClick={completeWorkout}
            className="flex-1 btn-primary"
            disabled={workoutSession?.exercises.length === 0}
          >
            Complete Workout
          </button>
        </div>
      </div>
    </div>
  );
}
