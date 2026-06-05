import { Schema } from "effect"
import { Identifier } from "@/id/id"
import { zod, ZodOverride } from "@/util/effect-zod"
import { withStatics } from "@/util/schema"

export const UserID = Schema.String.annotate({ [ZodOverride]: Identifier.schema("user") }).pipe(
  Schema.brand("UserID"),
  withStatics((s) => ({
    make: (id?: string) => s.make(Identifier.ascending("user", id)),
    zod: zod(s),
  })),
)

export type UserID = Schema.Schema.Type<typeof UserID>

export class User extends Schema.Class<User>("User")({
  id: UserID,
  username: Schema.String,
  created_at: Schema.Number,
}) {}

export class UserWithPassword extends Schema.Class<UserWithPassword>("UserWithPassword")({
  id: UserID,
  username: Schema.String,
  password_hash: Schema.String,
  created_at: Schema.Number,
}) {}

export class AuthToken extends Schema.Class<AuthToken>("AuthToken")({
  token: Schema.String,
  user: User,
}) {}

export class LoginRequest extends Schema.Class<LoginRequest>("LoginRequest")({
  username: Schema.String,
  password: Schema.String,
}) {}

export class ChangePasswordRequest extends Schema.Class<ChangePasswordRequest>("ChangePasswordRequest")({
  current_password: Schema.String,
  new_password: Schema.String,
}) {}

export class CreateUserRequest extends Schema.Class<CreateUserRequest>("CreateUserRequest")({
  username: Schema.String,
  password: Schema.String,
}) {}

export class AuthError extends Schema.TaggedErrorClass<AuthError>()("AuthError", {
  message: Schema.String,
  cause: Schema.optional(Schema.Defect),
}) {}

export class AuthValidationError extends Schema.TaggedErrorClass<AuthValidationError>()("AuthValidationError", {
  message: Schema.String,
}) {}
