-- Polymorphic uniqueness: a user can favorite each target at most once.
CREATE UNIQUE INDEX "Favorite_user_track_unique" ON "Favorite" ("userId", "trackId") WHERE "trackId" IS NOT NULL;
CREATE UNIQUE INDEX "Favorite_user_album_unique" ON "Favorite" ("userId", "albumId") WHERE "albumId" IS NOT NULL;
CREATE UNIQUE INDEX "Favorite_user_artist_unique" ON "Favorite" ("userId", "artistId") WHERE "artistId" IS NOT NULL;
CREATE UNIQUE INDEX "Favorite_user_playlist_unique" ON "Favorite" ("userId", "playlistId") WHERE "playlistId" IS NOT NULL;

-- Exactly one favorite target must be set.
ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_one_target_check" CHECK (
  ((("trackId" IS NOT NULL)::int + ("albumId" IS NOT NULL)::int + ("artistId" IS NOT NULL)::int + ("playlistId" IS NOT NULL)::int)) = 1
);

-- A user can follow each user/artist at most once, and exactly one target must be set.
CREATE UNIQUE INDEX "Follow_user_unique" ON "Follow" ("followerId", "followedUserId") WHERE "followedUserId" IS NOT NULL;
CREATE UNIQUE INDEX "Follow_artist_unique" ON "Follow" ("followerId", "artistId") WHERE "artistId" IS NOT NULL;
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_one_target_check" CHECK (
  ((("followedUserId" IS NOT NULL)::int + ("artistId" IS NOT NULL)::int)) = 1
);

-- Users cannot follow themselves.
ALTER TABLE "Follow" ADD CONSTRAINT "Follow_no_self_check" CHECK ("followedUserId" IS DISTINCT FROM "followerId");
