create or replace function public.evia_delete_account(p_user_id text)
returns jsonb language plpgsql set search_path='' as $function$
declare shredded integer := 0; uid uuid := p_user_id::uuid;
begin
 perform id from public.users where id=uid for update;
 if not found then return jsonb_build_object('ok',true,'blobsShredded',0,'blobsFailed',0); end if;
 delete from public.blobs where ref in (
 select image_ref from public.skin_scans where user_id=uid union
 select thumb_ref from public.skin_scans where user_id=uid union
 select image_ref from public.body_scans where user_id=uid union
 select profile_image_ref from public.body_scans where user_id=uid union
 select blob_ref from public.progress_photos where user_id=uid);
 get diagnostics shredded=row_count;
 delete from public.products where owner_id=uid;
 delete from public.users where id=uid;
 return jsonb_build_object('ok',true,'blobsShredded',shredded,'blobsFailed',0);
end $function$;
