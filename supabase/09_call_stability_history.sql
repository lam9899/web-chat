-- TALK CÙNG LÂM DZ — ỔN ĐỊNH CUỘC GỌI VÀ LỊCH SỬ
-- Chạy một lần sau file 08_voice_video_calls.sql.
-- Bổ sung heartbeat, tự dọn cuộc gọi treo và dữ liệu lịch sử.

alter table public.call_sessions
  add column if not exists caller_last_seen_at timestamptz;

alter table public.call_sessions
  add column if not exists receiver_last_seen_at timestamptz;

alter table public.call_sessions
  add column if not exists end_reason text;

alter table public.call_sessions
  add column if not exists ended_by uuid;

update public.call_sessions
set
  caller_last_seen_at = coalesce(
    caller_last_seen_at,
    answered_at,
    created_at
  ),
  receiver_last_seen_at = case
    when status in ('accepted', 'ended')
      and answered_at is not null
    then coalesce(
      receiver_last_seen_at,
      answered_at,
      updated_at
    )
    else receiver_last_seen_at
  end
where caller_last_seen_at is null
   or (
     receiver_last_seen_at is null
     and answered_at is not null
   );

create index if not exists call_sessions_heartbeat_idx
on public.call_sessions (
  status,
  caller_last_seen_at,
  receiver_last_seen_at
)
where status in ('ringing', 'accepted');

create or replace function public.cleanup_stale_calls()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  affected_rows integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Bạn chưa đăng nhập.'
      using errcode = '42501';
  end if;

  with missed_calls as (
    update public.call_sessions
    set
      status = 'missed',
      ended_at = coalesce(ended_at, now()),
      end_reason = coalesce(end_reason, 'timeout'),
      updated_at = now()
    where status = 'ringing'
      and created_at < now() - interval '90 seconds'
    returning 1
  ),
  disconnected_calls as (
    update public.call_sessions
    set
      status = 'ended',
      ended_at = coalesce(ended_at, now()),
      end_reason = coalesce(end_reason, 'disconnect'),
      updated_at = now()
    where status = 'accepted'
      and (
        coalesce(
          caller_last_seen_at,
          answered_at,
          updated_at
        ) < now() - interval '90 seconds'
        or
        coalesce(
          receiver_last_seen_at,
          answered_at,
          updated_at
        ) < now() - interval '90 seconds'
      )
    returning 1
  )
  select (
    (select count(*) from missed_calls)
    +
    (select count(*) from disconnected_calls)
  )::integer
  into affected_rows;

  return affected_rows;
end;
$$;

create or replace function public.heartbeat_private_call(
  p_call_id uuid
)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_call public.call_sessions;
begin
  if current_user_id is null then
    raise exception 'Bạn chưa đăng nhập.'
      using errcode = '42501';
  end if;

  select *
  into target_call
  from public.call_sessions
  where id = p_call_id
  for update;

  if not found then
    raise exception 'Không tìm thấy cuộc gọi.'
      using errcode = 'P0002';
  end if;

  if current_user_id not in (
    target_call.caller_id,
    target_call.receiver_id
  ) then
    raise exception 'Bạn không thuộc cuộc gọi này.'
      using errcode = '42501';
  end if;

  if target_call.status not in ('ringing', 'accepted') then
    return target_call;
  end if;

  update public.call_sessions
  set
    caller_last_seen_at = case
      when current_user_id = caller_id
      then now()
      else caller_last_seen_at
    end,
    receiver_last_seen_at = case
      when current_user_id = receiver_id
      then now()
      else receiver_last_seen_at
    end,
    updated_at = now()
  where id = p_call_id
  returning *
  into target_call;

  return target_call;
end;
$$;

create or replace function public.create_private_call(
  p_receiver_id uuid,
  p_call_type text
)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  new_call public.call_sessions;
begin
  if current_user_id is null then
    raise exception 'Bạn chưa đăng nhập.'
      using errcode = '42501';
  end if;

  if p_receiver_id is null
     or p_receiver_id = current_user_id then
    raise exception 'Người nhận cuộc gọi không hợp lệ.'
      using errcode = '22023';
  end if;

  if p_call_type not in ('audio', 'video') then
    raise exception 'Loại cuộc gọi không hợp lệ.'
      using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.profiles
    where id = p_receiver_id
  ) then
    raise exception 'Không tìm thấy thành viên.'
      using errcode = 'P0002';
  end if;

  if public.is_user_suspended(current_user_id)
     or public.is_user_suspended(p_receiver_id) then
    raise exception 'Một trong hai tài khoản đang bị khóa chat.'
      using errcode = '42501';
  end if;

  if exists (
    select 1
    from public.user_blocks b
    where
      (
        b.blocker_id = current_user_id
        and b.blocked_id = p_receiver_id
      )
      or
      (
        b.blocker_id = p_receiver_id
        and b.blocked_id = current_user_id
      )
  ) then
    raise exception 'Không thể gọi vì một trong hai tài khoản đã chặn người còn lại.'
      using errcode = '42501';
  end if;

  perform public.cleanup_stale_calls();

  if exists (
    select 1
    from public.call_sessions c
    where c.status in ('ringing', 'accepted')
      and (
        c.caller_id in (
          current_user_id,
          p_receiver_id
        )
        or c.receiver_id in (
          current_user_id,
          p_receiver_id
        )
      )
  ) then
    raise exception 'Một trong hai thành viên đang có cuộc gọi khác.'
      using errcode = 'P0001';
  end if;

  insert into public.call_sessions (
    caller_id,
    receiver_id,
    call_type,
    room_name,
    caller_last_seen_at,
    end_reason,
    ended_by
  )
  values (
    current_user_id,
    p_receiver_id,
    p_call_type,
    'call-' || replace(
      gen_random_uuid()::text,
      '-',
      ''
    ),
    now(),
    null,
    null
  )
  returning *
  into new_call;

  return new_call;
end;
$$;

create or replace function public.respond_private_call(
  p_call_id uuid,
  p_response text
)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_call public.call_sessions;
begin
  if current_user_id is null then
    raise exception 'Bạn chưa đăng nhập.'
      using errcode = '42501';
  end if;

  if p_response not in ('accepted', 'declined') then
    raise exception 'Phản hồi cuộc gọi không hợp lệ.'
      using errcode = '22023';
  end if;

  perform public.cleanup_stale_calls();

  select *
  into target_call
  from public.call_sessions
  where id = p_call_id
  for update;

  if not found then
    raise exception 'Không tìm thấy cuộc gọi.'
      using errcode = 'P0002';
  end if;

  if target_call.receiver_id <> current_user_id then
    raise exception 'Bạn không thể trả lời cuộc gọi này.'
      using errcode = '42501';
  end if;

  if target_call.status <> 'ringing' then
    return target_call;
  end if;

  update public.call_sessions
  set
    status = p_response,
    answered_at = case
      when p_response = 'accepted'
      then now()
      else answered_at
    end,
    ended_at = case
      when p_response = 'declined'
      then now()
      else null
    end,
    caller_last_seen_at = case
      when p_response = 'accepted'
      then now()
      else caller_last_seen_at
    end,
    receiver_last_seen_at = now(),
    end_reason = case
      when p_response = 'declined'
      then 'declined'
      else null
    end,
    ended_by = case
      when p_response = 'declined'
      then current_user_id
      else null
    end,
    updated_at = now()
  where id = p_call_id
  returning *
  into target_call;

  return target_call;
end;
$$;

create or replace function public.end_private_call(
  p_call_id uuid
)
returns public.call_sessions
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_user_id uuid := auth.uid();
  target_call public.call_sessions;
  next_status text;
  next_reason text;
begin
  if current_user_id is null then
    raise exception 'Bạn chưa đăng nhập.'
      using errcode = '42501';
  end if;

  select *
  into target_call
  from public.call_sessions
  where id = p_call_id
  for update;

  if not found then
    raise exception 'Không tìm thấy cuộc gọi.'
      using errcode = 'P0002';
  end if;

  if current_user_id not in (
    target_call.caller_id,
    target_call.receiver_id
  ) then
    raise exception 'Bạn không thuộc cuộc gọi này.'
      using errcode = '42501';
  end if;

  if target_call.status not in ('ringing', 'accepted') then
    return target_call;
  end if;

  if target_call.status = 'ringing'
     and current_user_id = target_call.receiver_id then
    next_status := 'declined';
    next_reason := 'declined';
  elsif target_call.status = 'ringing' then
    next_status := 'ended';
    next_reason := 'cancelled';
  else
    next_status := 'ended';
    next_reason := 'completed';
  end if;

  update public.call_sessions
  set
    status = next_status,
    ended_at = now(),
    end_reason = next_reason,
    ended_by = current_user_id,
    caller_last_seen_at = case
      when current_user_id = caller_id
      then now()
      else caller_last_seen_at
    end,
    receiver_last_seen_at = case
      when current_user_id = receiver_id
      then now()
      else receiver_last_seen_at
    end,
    updated_at = now()
  where id = p_call_id
  returning *
  into target_call;

  return target_call;
end;
$$;

revoke all
on function public.cleanup_stale_calls()
from public;

revoke all
on function public.heartbeat_private_call(uuid)
from public;

revoke all
on function public.create_private_call(uuid, text)
from public;

revoke all
on function public.respond_private_call(uuid, text)
from public;

revoke all
on function public.end_private_call(uuid)
from public;

grant execute
on function public.cleanup_stale_calls()
to authenticated;

grant execute
on function public.heartbeat_private_call(uuid)
to authenticated;

grant execute
on function public.create_private_call(uuid, text)
to authenticated;

grant execute
on function public.respond_private_call(uuid, text)
to authenticated;

grant execute
on function public.end_private_call(uuid)
to authenticated;

-- Dọn ngay các trạng thái cũ còn treo trước khi cài bản mới.
update public.call_sessions
set
  status = 'missed',
  ended_at = coalesce(ended_at, now()),
  end_reason = coalesce(end_reason, 'timeout'),
  updated_at = now()
where status = 'ringing'
  and created_at < now() - interval '90 seconds';

update public.call_sessions
set
  status = 'ended',
  ended_at = coalesce(ended_at, now()),
  end_reason = coalesce(end_reason, 'disconnect'),
  updated_at = now()
where status = 'accepted'
  and (
    coalesce(
      caller_last_seen_at,
      answered_at,
      updated_at
    ) < now() - interval '90 seconds'
    or
    coalesce(
      receiver_last_seen_at,
      answered_at,
      updated_at
    ) < now() - interval '90 seconds'
  );
