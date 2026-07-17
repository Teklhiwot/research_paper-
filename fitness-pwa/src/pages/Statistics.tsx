import { useEffect, useState } from 'react';
import { db } from '../database/db';
import { TrendingDownIcon, FireIcon } from '../components/Icons';

export default function Statistics() {
  const [workoutStats, setWorkoutStats] = useState({
    total: 0,
    thisMonth: 0,
    thisWeek: 0,
    streak: 0,
    completionRate: 0,
  });
  const [weightStats, setWeightStats] = useState({
    startWeight: 0,
    currentWeight: 0,
    weightLost: 0,
    lowestWeight: 0,
  });

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      // Load workout statistics
      const workouts = await db.workoutSessions.toArray();
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const weekStart = new Date(now.setDate(now.getDate() - now.getDay()));

      const thisMonthWorkouts = workouts.filter(w => new Date(w.date) >= monthStart);
      const thisWeekWorkouts = workouts.filter(w => new Date(w.date) >= weekStart);
      const completedWorkouts = workouts.filter(w => w.completed);
      const completionRate = workouts.length > 0 ? Math.round((completedWorkouts.length / workouts.length) * 100) : 0;

      // Calculate streak
      let streak = 0;
      let currentDate = new Date();
      currentDate.setHours(0, 0, 0, 0);

      for (const workout of workouts.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())) {
        const workoutDate = new Date(workout.date);
        workoutDate.setHours(0, 0, 0, 0);

        if (workoutDate.getTime() === currentDate.getTime()) {
          streak++;
          currentDate.setDate(currentDate.getDate() - 1);
        } else if (workoutDate.getTime() < currentDate.getTime()) {
          break;
        }
      }

      setWorkoutStats({
        total: workouts.length,
        thisMonth: thisMonthWorkouts.length,
        thisWeek: thisWeekWorkouts.length,
        streak,
        completionRate,
      });

      // Load weight statistics
      const weights = await db.weightEntries.orderBy('date').toArray();
      if (weights.length > 0) {
        const currentWeight = weights[weights.length - 1].weight;
        const startWeight = weights[0].weight;
        const lowestWeight = Math.min(...weights.map(w => w.weight));
        const weightLost = startWeight - currentWeight;

        setWeightStats({
          startWeight,
          currentWeight,
          weightLost,
          lowestWeight,
        });
      }
    } catch (error) {
      console.error('Failed to load statistics:', error);
    }
  };

  return (
    <div className="min-h-screen bg-white dark:bg-slate-950 p-4 md:p-8">
      <div className="max-w-6xl mx-auto">
        <div className="mb-8">
          <h1 className="text-4xl md:text-5xl font-bold text-slate-900 dark:text-white mb-2">
            Statistics
          </h1>
          <p className="text-slate-600 dark:text-slate-400">
            Your fitness journey progress
          </p>
        </div>

        {/* Workout Statistics */}
        <div className="mb-8">
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
            Workout Stats
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Total Workouts
              </h3>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">
                {workoutStats.total}
              </p>
            </div>

            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                This Month
              </h3>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">
                {workoutStats.thisMonth}
              </p>
            </div>

            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                This Week
              </h3>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">
                {workoutStats.thisWeek}
              </p>
            </div>

            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Current Streak
              </h3>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold text-slate-900 dark:text-white">
                  {workoutStats.streak}
                </p>
                <FireIcon className="w-5 h-5 text-orange-500" />
              </div>
            </div>

            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Completion
              </h3>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">
                {workoutStats.completionRate}%
              </p>
            </div>
          </div>
        </div>

        {/* Weight Statistics */}
        <div>
          <h2 className="text-2xl font-bold text-slate-900 dark:text-white mb-4">
            Weight Progress
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Starting Weight
              </h3>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">
                {weightStats.startWeight > 0 ? weightStats.startWeight.toFixed(1) : '--'} kg
              </p>
            </div>

            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Current Weight
              </h3>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">
                {weightStats.currentWeight > 0 ? weightStats.currentWeight.toFixed(1) : '--'} kg
              </p>
            </div>

            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Weight Lost
              </h3>
              <div className="flex items-center gap-2">
                <p className="text-3xl font-bold text-green-500">
                  {weightStats.weightLost.toFixed(1)} kg
                </p>
                <TrendingDownIcon className="w-5 h-5 text-green-500" />
              </div>
            </div>

            <div className="card-lg">
              <h3 className="text-sm font-semibold text-slate-600 dark:text-slate-400 mb-2">
                Lowest Weight
              </h3>
              <p className="text-3xl font-bold text-slate-900 dark:text-white">
                {weightStats.lowestWeight > 0 ? weightStats.lowestWeight.toFixed(1) : '--'} kg
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
