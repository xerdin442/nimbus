import { Module } from '@nestjs/common';
import { DashboardMoviesController } from './controllers/dashboard/movies.controller';
import { V1MoviesController } from './controllers/v1/movies.controller';
import { MoviesService } from './movies.service';
import { TmdbProvider } from './providers/tmdb.provider';

@Module({
  controllers: [DashboardMoviesController, V1MoviesController],
  providers: [MoviesService, TmdbProvider],
  exports: [MoviesService],
})
export class MoviesModule {}
