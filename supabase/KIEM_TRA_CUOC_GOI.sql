-- Kiểm tra 20 cuộc gọi gần nhất.
select
  id,
  caller_id,
  receiver_id,
  call_type,
  status,
  end_reason,
  created_at,
  answered_at,
  ended_at,
  case
    when answered_at is not null
      and ended_at is not null
    then extract(
      epoch from ended_at - answered_at
    )::integer
    else null
  end as duration_seconds
from public.call_sessions
order by created_at desc
limit 20;

-- Sau khoảng 90 giây, kết quả này phải là 0 rows
-- nếu hai người đã thoát hoặc cuộc gọi không được trả lời.
select
  id,
  status,
  caller_last_seen_at,
  receiver_last_seen_at,
  created_at,
  updated_at
from public.call_sessions
where status in ('ringing', 'accepted');
