-- Rooms that already have a frame in them
--
-- A room photograph comes one of two ways. Either it's an empty wall, and the
-- site draws the whole framed piece onto it; or it's a render that already
-- contains a frame and a mat, in which case the frame in the picture has real
-- light, a real contact shadow and real perspective, and the only thing
-- missing is the photograph. Drawing our own frame over that one would give
-- you a frame inside a frame.
--
-- Default true, because a room with a frame already in it is what most stock
-- interior mockups look like.
--
-- Safe to run more than once.

alter table room_scenes
  add column if not exists has_frame boolean not null default true;

notify pgrst, 'reload schema';

select column_name, data_type, column_default
from information_schema.columns
where table_name = 'room_scenes' and column_name = 'has_frame';
